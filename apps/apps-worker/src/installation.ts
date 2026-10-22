import { appRuntimeIssuer, bearerToken } from "@patchsmith/api-utils/app-auth";
import type { Invocation } from "@patchsmith/app/protocol";
import { AppError } from "@patchsmith/app/server";
import type { Identity } from "@patchsmith/app/server";
import { DurableObject } from "cloudflare:workers";
import { Effect, Semaphore } from "effect";
import { catch as catchEffect } from "effect/Effect";

import bootstrap from "../.generated/bootstrap.txt";
import type { AppFacet } from "./dynamic-workers/facet";
import { abortable, cancellationStream } from "./runtime/cancellation";
import { appError, resultEffect } from "./runtime/errors";
import { ActionCapability, createActionLeases } from "./supervisor/actions";
import { verifier } from "./supervisor/auth";
import { deploymentSource, installationName } from "./supervisor/source";
import type { ServerDeployment } from "./supervisor/source";
import { createSubscriptions } from "./supervisor/subscriptions";
import { RuntimeTimings } from "./timing";
import {
  createInstallationHandler,
  rpcErrorResponse,
  requestRoute,
} from "./transport";
import type { Installation } from "./transport";

/** Trusted supervisor. The fixed facet name preserves SQLite when its code changes. */
export class PatchsmithAppInstallation extends DurableObject<Env> {
  readonly #http = createInstallationHandler();
  readonly #queue = Semaphore.makeUnsafe(1);
  readonly #actions = createActionLeases();
  readonly #verify = verifier(this.env);
  readonly #source = deploymentSource(this.env);
  #prepared:
    | {
        version: string;
        facet: Pick<AppFacet, "query" | "mutate" | "action">;
      }
    | undefined;

  readonly #subscriptions = createSubscriptions(
    this.ctx,
    (input: Invocation, identity: Identity) =>
      this.#databaseQuery(input, identity).pipe(
        Effect.flatMap((result) =>
          resultEffect(result.result).pipe(
            Effect.map((value) => ({ tables: result.tables, value }))
          )
        )
      ),
    this.#queue
  );

  async fetch(request: Request): Promise<Response> {
    const timings = new RuntimeTimings();
    const finish = timings.start("runtime_installation");

    const result = await Effect.runPromise(
      Effect.gen({ self: this }, function* install() {
        const token = yield* Effect.try({
          catch: appError,
          try: () => bearerToken(request),
        });

        const identity = yield* timings.measure(
          "runtime_auth",
          this.#verify(token)
        );

        yield* Effect.try({
          catch: appError,
          try: () => {
            const expected = this.env.STORES.idFromName(
              installationName(
                identity,
                appRuntimeIssuer(this.env.PLATFORM_URL)
              )
            );

            if (!this.ctx.id.equals(expected)) {
              throw new AppError("FORBIDDEN", "Installation mismatch");
            }
          },
        });
        const route = requestRoute(request);

        if (!route) {
          return yield* Effect.fail(
            new AppError("NOT_FOUND", "Unknown RPC route")
          );
        }

        if (route === "subscriptions") {
          yield* this.#source.current(
            identity,
            this.ctx.storage.kv.get<string>("version")?.split(":")[0]
          );

          return yield* Effect.tryPromise({
            catch: appError,
            try: async () => await this.#subscriptions.open(identity),
          });
        }

        const { matched, response } = yield* Effect.tryPromise({
          catch: appError,
          try: async () =>
            await this.#http.handle(request, {
              context: {
                installation: this.#operations(
                  identity,
                  token,
                  request.signal,
                  timings
                ),
              },
              prefix: "/rpc",
            }),
        });

        if (matched) {
          return response;
        }

        return yield* Effect.fail(
          new AppError("NOT_FOUND", "Unknown RPC route")
        );
      }).pipe(
        Effect.mapError(appError),

        catchEffect((err) => Effect.succeed(rpcErrorResponse(err)))
      )
    );

    finish();

    return timings.response(result);
  }

  #operations(
    identity: Identity,
    token: string,
    signal: AbortSignal | undefined,
    timings: RuntimeTimings
  ): Installation {
    return {
      action: (input, callSignal) =>
        this.#action(
          input,
          identity,
          token,
          timings,
          signal ?? callSignal
        ).pipe(Effect.flatMap((result) => resultEffect(result.result))),
      mutate: (input) =>
        this.#mutate(input, identity, timings).pipe(
          Effect.flatMap((result) => resultEffect(result.result))
        ),
      query: (input) =>
        this.#query(input, identity, timings).pipe(
          Effect.flatMap((result) => resultEffect(result.result))
        ),
    };
  }

  #facet(identity: Identity, timings = new RuntimeTimings()) {
    return Effect.gen({ self: this }, function* facet() {
      const deployment = yield* timings.measure(
        "runtime_metadata",
        this.#source.current(
          identity,
          this.ctx.storage.kv.get<string>("version")?.split(":")[0],
          timings
        )
      );

      return (yield* timings.measure(
        "runtime_prepare",
        this.#prepareFacet(deployment, identity, timings)
      )).facet;
    });
  }

  async #callFacet<T>(facet: Pick<AppFacet, "query">, call: () => Promise<T>) {
    try {
      return await call();
    } catch (error) {
      // An older in-flight action must not evict a replacement deployment's stub.
      if (this.#prepared?.facet === facet) {
        this.#prepared = undefined;
      }

      throw error;
    }
  }

  #databaseQuery(
    input: Invocation,
    identity: Identity,
    timings = new RuntimeTimings()
  ) {
    return this.#facet(identity, timings).pipe(
      Effect.flatMap((facet: Pick<AppFacet, "query">) =>
        timings.measure(
          "runtime_execute",
          Effect.tryPromise({
            catch: appError,
            try: async () =>
              await this.#callFacet(
                facet,
                async () => await facet.query(input, identity)
              ),
          })
        )
      )
    );
  }

  #query(input: Invocation, identity: Identity, timings: RuntimeTimings) {
    return this.#queued(this.#databaseQuery(input, identity, timings), timings);
  }

  #queued<A, E, R>(operation: Effect.Effect<A, E, R>, timings: RuntimeTimings) {
    return Effect.suspend(() => {
      const admitted = timings.start("runtime_queue");

      return this.#queue.withPermits(1)(
        Effect.gen(function* queued() {
          admitted();

          return yield* operation;
        })
      );
    });
  }

  #mutate(
    input: Invocation & { requestId: string },
    identity: Identity,
    timings: RuntimeTimings
  ) {
    return this.#queued(
      Effect.gen({ self: this }, function* mutation() {
        const facet = yield* this.#facet(identity, timings);

        const result = yield* timings.measure(
          "runtime_execute",
          Effect.tryPromise({
            catch: appError,
            try: async () =>
              await this.#callFacet(
                facet,
                async () => await facet.mutate(input, identity)
              ),
          })
        );

        if (result.committed && result.tables.length) {
          yield* this.#refresh(result.tables, facet);
        }

        return result;
      }),
      timings
    );
  }

  #refresh(tables: string[], facet: Pick<AppFacet, "query">) {
    return this.#subscriptions.refresh(
      tables,
      (input: Invocation, subscriber) =>
        Effect.tryPromise({
          catch: appError,
          try: async () =>
            await this.#callFacet(
              facet,
              async () => await facet.query(input, subscriber)
            ),
        }).pipe(
          Effect.flatMap((result) =>
            resultEffect(result.result).pipe(
              Effect.map((value) => ({ tables: result.tables, value }))
            )
          )
        )
    );
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.#subscriptions.message(socket, message);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    await this.#subscriptions.close(socket, code, reason);
  }

  async webSocketError(socket: WebSocket) {
    await this.#subscriptions.close(socket, 1011, "Socket error");
  }

  async alarm() {
    await this.#subscriptions.alarm();
  }

  #prepareFacet(
    deployment: ServerDeployment,
    identity: Identity,
    timings: RuntimeTimings
  ) {
    return Effect.gen({ self: this }, function* prepareFacet() {
      const version = `${deployment.deploymentId}:${deployment.checksum}`;

      if (identity.expiresAt <= Date.now()) {
        return yield* Effect.fail(
          new AppError("UNAUTHORIZED", "App token expired")
        );
      }

      if (this.#prepared?.version === version) {
        return { facet: this.#prepared.facet };
      }

      // Verify code before stopping the running version. Cache belongs to this installation.
      const code = yield* timings.measure(
        "runtime_bundle",
        this.#source.code(deployment)
      );

      return yield* Effect.try({
        catch: appError,
        try: () => {
          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          const previous = this.ctx.storage.kv.get<string>("version");

          if (
            previous !== undefined &&
            previous !== null &&
            previous !== "" &&
            previous !== version
          ) {
            for (const socket of this.ctx.getWebSockets()) {
              socket.close(1012, "App deployment changed");
            }

            this.#actions.closeAll();
            this.ctx.facets.abort("app", "App deployment changed");
          }

          if (previous !== version) {
            this.ctx.storage.kv.put("version", version);
          }

          // SAFETY: This facet factory returns AppFacet for this installation. Its methods validate input and serialize output; Cloudflare RPC declaration types erase heterogeneous schema results.
          const facet = this.ctx.facets.get("app", () => {
            const worker = this.env.LOADER.get(
              `${this.ctx.id.toString()}:${version}`,
              () => ({
                compatibilityDate: "2026-10-01",
                compatibilityFlags: ["nodejs_als"],
                env: {},
                globalOutbound: null,
                limits: { cpuMs: 10, subRequests: 64 },
                mainModule: "bootstrap.js",
                modules: { "application.js": code, "bootstrap.js": bootstrap },
              })
            );

            return {
              class: worker.getDurableObjectClass<AppFacet>("AppFacet"),
            };
          }) as Pick<AppFacet, "query" | "mutate" | "action">;

          // Runtime results have already passed JSON validation; CF's RPC types cannot describe unknown values.
          this.#prepared = { facet, version };

          return { facet };
        },
      });
    });
  }

  #action(
    input: Invocation,
    identity: Identity,
    token: string,
    timings: RuntimeTimings,
    signal?: AbortSignal
  ) {
    const admission = this.#queued(
      Effect.gen({ self: this }, function* admission() {
        const facet = yield* this.#facet(identity, timings);

        return { facet, lease: this.#actions.open(identity, signal) };
      }),
      timings
    );

    return Effect.acquireUseRelease(
      admission,
      ({ facet, lease }) =>
        timings.measure(
          "runtime_execute",
          Effect.tryPromise({
            catch: appError,
            try: async () => {
              lease.signal.throwIfAborted();

              const capability = new ActionCapability(
                lease,
                async (tables) => {
                  await Effect.runPromise(
                    this.#queue.withPermits(1)(this.#refresh(tables, facet))
                  );
                },
                { token, url: identity.toolUrl }
              );

              return await abortable(
                this.#callFacet(
                  facet,
                  async () =>
                    await facet.action(
                      input,
                      identity,
                      capability,
                      cancellationStream(lease.signal)
                    )
                ),
                lease.signal
              );
            },
          })
        ),
      ({ lease }) =>
        Effect.sync(() => {
          lease.close();
        })
    );
  }
}
