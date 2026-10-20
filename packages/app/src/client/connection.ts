import { createORPCClient } from "@orpc/client";
import { RPCLink as FetchLink } from "@orpc/client/fetch";
import { RPCLink } from "@orpc/client/websocket";

import { AppError, appError } from "#errors";
import type { PlatformClient, SubscriptionClient } from "#protocol";

import type { Reference } from "./reference";
import { sessionRenewalDelay } from "./session";
import type { Session } from "./session";

export type { Session } from "./session";

export { reference } from "./reference";

export type { Reference, References } from "./reference";

export { AppError } from "#errors";

type InputArguments<I> = undefined extends I ? [args?: I] : [args: I];

type MutationArguments<I> = undefined extends I
  ? [args?: I, options?: { requestId?: string }]
  : [args: I, options?: { requestId?: string }];

export interface Client {
  query: <I, O>(
    reference: Reference<"query", I, O>,
    ...args: InputArguments<NoInfer<I>>
  ) => Promise<O>;
  mutate: <I, O>(
    reference: Reference<"mutation", I, O>,
    ...args: MutationArguments<NoInfer<I>>
  ) => Promise<O>;
  action: <I, O>(
    reference: Reference<"action", I, O>,
    ...args: InputArguments<NoInfer<I>>
  ) => Promise<O>;
  subscribe: <I, O>(
    reference: Reference<"query", I, O>,
    args: NoInfer<I>,
    next: (value: O) => void,
    options?: { onError?: (error: AppError) => void }
  ) => () => void;
  close: () => void;
}

const backendUrl = (session: Session, route: string) => {
  const url = new URL(session.url);
  if (url.username || url.password || url.search || url.hash) {
    throw new AppError("BAD_REQUEST", "Invalid app backend URL");
  }
  if (url.protocol === "wss:") {
    url.protocol = "https:";
  }
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new AppError("BAD_REQUEST", "App backends require HTTPS");
  }
  if (session.expiresAt <= Date.now() + 1000) {
    throw new AppError("UNAUTHORIZED", "App token expired");
  }
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/${route}`;
  return url;
};

const waitForRetry = async (
  signal: AbortSignal,
  delayMs: number
): Promise<void> => {
  if (signal.aborted) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<ReturnType<() => void>>();
  const timer = setTimeout(resolve, delayMs);
  const wake = () => {
    resolve();
  };
  try {
    signal.addEventListener("abort", wake, { once: true });
    await promise;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", wake);
  }
};

export const createClient = (
  options: {
    getSession?: (options: { refresh: boolean }) => Promise<Session>;
    connect?: (
      url: string,
      protocols: string[]
    ) => WebSocket | Promise<WebSocket>;
    fetch?: typeof fetch;
    retryDelayMs?: number;
  } = {}
): Client => {
  let closed = false;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stops = new Set<() => void>();
  const requests = new Set<AbortController>();
  const getSession =
    options.getSession ??
    (async (request: { refresh: boolean }) => {
      const bridge = globalThis.__patchsmithBackendSession;
      if (!bridge) {
        throw new AppError("UNAVAILABLE", "The host JWT bridge is unavailable");
      }
      return await bridge(request);
    });
  const wire = createORPCClient<SubscriptionClient>(
    new RPCLink({
      connect: async (info) => {
        if (closed) {
          throw new AppError("UNAVAILABLE", "App client closed");
        }
        const session = await getSession({ refresh: info.totalAttempt > 1 });
        if (closed) {
          throw new AppError("UNAVAILABLE", "App client closed");
        }
        const url = backendUrl(session, "queries");
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = await (
          options.connect ??
          ((urlValue: string, protocols) => new WebSocket(urlValue, protocols))
        )(url.href, ["patchsmith", `jwt.${session.token}`]);
        // Reconnect one minute before expiry. Active subscriptions obtain fresh snapshots automatically.
        clearTimeout(timer);
        timer = setTimeout(
          () => socket?.close(1000, "Renew authentication"),
          sessionRenewalDelay(session)
        );
        return socket;
      },
      reconnect: {
        delay: (info) =>
          info.attempt === 1 ? 0 : (options.retryDelayMs ?? 1000),
        enabled: true,
      },
    })
  );
  const call = async (
    kind: "queries" | "mutations" | "actions",
    input: { name: string; args?: unknown; requestId?: string }
  ) => {
    if (closed) {
      throw new AppError("UNAVAILABLE", "App client closed");
    }
    const controller = new AbortController();
    requests.add(controller);
    try {
      // Freeze the invocation so retries retain the receipt fingerprint even if callers change args.
      const invocation = kind === "mutations" ? structuredClone(input) : input;
      let attempt = 0;
      let refresh = false;
      let refreshed = false;
      while (true) {
        try {
          if (closed) {
            throw new AppError("UNAVAILABLE", "App client closed");
          }
          // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
          const session = await getSession({ refresh });
          refresh = false;
          if (closed) {
            throw new AppError("UNAVAILABLE", "App client closed");
          }
          const url = backendUrl(session, kind);
          url.pathname = url.pathname
            .slice(0, -kind.length)
            .replace(/\/$/u, "");
          const http = createORPCClient<PlatformClient>(
            new FetchLink({
              fetch: async (urlValue2: string, init) => {
                let response: Response;
                try {
                  response = await (options.fetch ?? fetch)(urlValue2, {
                    ...init,
                    credentials: "omit",
                  });
                } catch {
                  throw new AppError(
                    "UNAVAILABLE",
                    "App connection interrupted"
                  );
                }
                if ([502, 503, 504].includes(response.status)) {
                  throw new AppError(
                    "UNAVAILABLE",
                    "App backend temporarily unavailable"
                  );
                }
                // A connection can drop after headers arrive but before the mutation result does.
                if (kind === "mutations" && response.body) {
                  try {
                    return new Response(await response.arrayBuffer(), {
                      headers: response.headers,
                      status: response.status,
                    });
                  } catch {
                    throw new AppError(
                      "UNAVAILABLE",
                      "App connection interrupted"
                    );
                  }
                }
                return response;
              },
              headers: { authorization: `Bearer ${session.token}` },
              origin: url.origin,
              url: `/${url.pathname.slice(1)}`,
            })
          );
          if (kind === "mutations") {
            // SAFETY: The mutation branch assigned invocation.requestId before entering this retry loop.
            // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
            return await http.mutations(
              /* oxlint-disable typescript/no-unsafe-type-assertion -- The mutation branch assigned invocation.requestId before entering this retry loop. */
              invocation as typeof input & { requestId: string },
              /* oxlint-enable typescript/no-unsafe-type-assertion */
              {
                signal: controller.signal,
              }
            );
          }
          // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
          return await http[kind](invocation, { signal: controller.signal });
        } catch (error) {
          const failure = appError(error);
          if (kind !== "mutations" || closed || controller.signal.aborted) {
            throw failure;
          }
          if (failure.code === "UNAUTHORIZED" && !refreshed) {
            refresh = true;
            refreshed = true;
            continue;
          }
          if (failure.code !== "UNAVAILABLE") {
            throw failure;
          }
          // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
          await waitForRetry(
            controller.signal,
            Math.min(
              (options.retryDelayMs ?? 1000) *
                2 ** Math.min((attempt += 1) - 1, 5),
              30_000
            )
          );
        }
      }
    } catch (error) {
      throw appError(error);
    } finally {
      requests.delete(controller);
    }
  };
  return {
    // SAFETY: The action reference owns its output type, and the server validates that registered action before the shared transport returns its erased result.
    action: async (ref, ...[args]) =>
      await /* oxlint-disable typescript/no-unsafe-type-assertion -- The action reference owns its output type, and the server validates that registered action before the shared transport returns its erased result. */
      (call("actions", { args, name: ref.name }) as Promise<never>),
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    close: () => {
      closed = true;
      for (const stop of stops) {
        stop();
      }
      for (const request of requests) {
        request.abort();
      }
      clearTimeout(timer);
      socket?.close();
    },
    // SAFETY: The mutation reference owns its output type, and the server validates that registered mutation before the shared transport returns its erased result.
    mutate: async (ref, ...[args, settings]) =>
      await /* oxlint-disable typescript/no-unsafe-type-assertion -- The mutation reference owns its output type, and the server validates that registered mutation before the shared transport returns its erased result. */
      (call("mutations", {
        args,
        name: ref.name,
        requestId: settings?.requestId ?? crypto.randomUUID(),
      }) as Promise<never>),
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    // SAFETY: The query reference owns its output type, and the server validates that registered query before the shared transport returns its erased result.
    query: async (ref, ...[args]) =>
      await /* oxlint-disable typescript/no-unsafe-type-assertion -- The query reference owns its output type, and the server validates that registered query before the shared transport returns its erased result. */
      (call("queries", { args, name: ref.name }) as Promise<never>),
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    subscribe: (ref, args, onValue, settings = {}) => {
      if (closed) {
        throw new AppError("UNAVAILABLE", "App client closed");
      }
      const controller = new AbortController();
      const stop = () => {
        controller.abort();
        stops.delete(stop);
      };
      stops.add(stop);
      const run = async () => {
        while (!controller.signal.aborted) {
          try {
            // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
            const stream = await wire.subscribe(
              { args, name: ref.name },
              { signal: controller.signal }
            );
            // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
            for await (const value of stream) {
              if (controller.signal.aborted || closed) {
                break;
              }
              // SAFETY: This subscription was opened with ref.name and args; its listener receives only results from that same registered query, whose output generic is erased by the transport.
              onValue(
                /* oxlint-disable typescript/no-unsafe-type-assertion -- This subscription was opened with ref.name and args; its listener receives only results from that same registered query, whose output generic is erased by the transport. */
                value as never
                /* oxlint-enable typescript/no-unsafe-type-assertion */
              );
            }
          } catch (error) {
            if (controller.signal.aborted || closed) {
              break;
            }
            const failure = appError(error);
            if (!(error instanceof Error && error.name === "AbortError")) {
              settings.onError?.(failure);
            }
            if (
              ![
                "UNAUTHORIZED",
                "UNAVAILABLE",
                "INTERNAL_SERVER_ERROR",
              ].includes(failure.code)
            ) {
              break;
            }
          }
          if (!controller.signal.aborted && !closed) {
            // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
            await waitForRetry(controller.signal, options.retryDelayMs ?? 1000);
          }
        }
        stop();
      };
      void (async () => {
        try {
          await run();
        } catch (error) {
          stop();
          settings.onError?.(appError(error));
        }
      })();
      return stop;
    },
  };
};

export { createSessionProvider, parseSession } from "./session";
