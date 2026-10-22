import {
  appRuntimeIssuer,
  appDeploymentMetadata,
  deploymentMetadataKey,
  runtimeServiceAuthorized,
} from "@patchsmith/api-utils/app-auth";
import type { Identity } from "@patchsmith/app/server";
import { AppError } from "@patchsmith/app/server";
import {
  parseHostedAppRoute,
  parseDeploymentPublicationRoute,
} from "@patchsmith/asset-delivery";
import { Effect } from "effect";

import assets from "./assets";
import { validateDeploymentPublication } from "./publication";
import { appError } from "./runtime/errors";
import { verifier } from "./supervisor/auth";
import { metadataLifetimeSeconds, installationName } from "./supervisor/source";
import { RuntimeTimings } from "./timing";
import { routeInstallation, rpcErrorResponse } from "./transport";

export default {
  fetch: async (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> => {
    const domain = env.ASSET_DOMAIN;
    const publication = parseDeploymentPublicationRoute(request, domain);
    const appRoute = parseHostedAppRoute(request, domain);

    if (!publication && !appRoute) {
      // SAFETY: The worker forwards the same platform Request to the asset adapter; the two Workers declaration packages describe that Request differently.
      return await assets.fetch(
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The worker forwards the same platform Request to the asset adapter; the two Workers declaration packages describe that Request differently. */
        request as Parameters<typeof assets.fetch>[0],
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        env,
        ctx
      );
    }

    const cors = new Headers({
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "server-timing",
      "cache-control": "no-store",
    });

    const timings = new RuntimeTimings();
    const finish = timings.start("runtime_gateway");

    const response = await Effect.runPromise(
      Effect.gen(function* response() {
        if (publication) {
          if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }

          if (
            !(yield* Effect.tryPromise({
              catch: appError,
              try: async () =>
                await runtimeServiceAuthorized(
                  request,
                  env.RUNTIME_SERVICE_TOKEN
                ),
            }))
          ) {
            return yield* Effect.fail(
              new AppError(
                "UNAUTHORIZED",
                "Runtime service credential required"
              )
            );
          }

          const text = yield* Effect.tryPromise({
            catch: appError,
            try: async () => await request.text(),
          });

          if (text.length > 8192) {
            return yield* Effect.fail(
              new AppError("BAD_REQUEST", "Deployment metadata too large")
            );
          }

          const parsed = yield* Effect.try({
            catch: () =>
              new AppError("BAD_REQUEST", "Invalid deployment metadata"),
            try: () => appDeploymentMetadata.safeParse(JSON.parse(text)),
          });

          if (!parsed.success) {
            return yield* Effect.fail(
              new AppError("BAD_REQUEST", "Invalid deployment metadata")
            );
          }

          yield* Effect.try({
            catch: appError,
            try: () => {
              validateDeploymentPublication(parsed.data, publication);
            },
          });
          yield* Effect.tryPromise({
            catch: appError,
            try: async () => {
              await env.DEPLOYMENTS.put(
                deploymentMetadataKey(parsed.data),
                JSON.stringify(parsed.data),
                {
                  expirationTtl: metadataLifetimeSeconds,
                }
              );
            },
          });

          return new Response(null, { status: 204 });
        }

        if (!appRoute) {
          return new Response("Not found", { status: 404 });
        }

        const url = new URL(request.url);
        url.pathname = appRoute.rpcPath;
        const routedRequest = new Request(url, request);

        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
        return yield* routeInstallation(routedRequest, {
          installation: (identity: Identity) =>
            env.STORES.getByName(
              installationName(identity, appRuntimeIssuer(env.PLATFORM_URL)),
              // New installations stay near the platform in us-east-1; existing objects retain their placement.
              { locationHint: "enam" }
            ),
          verify: (token) =>
            Effect.gen(function* verify() {
              const identity = yield* timings.measure(
                "runtime_gateway_auth",
                verifier(env)(token)
              );

              if (
                identity.projectShortId !== appRoute.projectShortId ||
                identity.appShortId !== appRoute.appShortId
              ) {
                return yield* Effect.fail(
                  new AppError(
                    "FORBIDDEN",
                    "App token does not match the route"
                  )
                );
              }

              return identity;
            }),
        });
      }).pipe(
        Effect.mapError(appError),
        Effect.catch((error) => Effect.succeed(rpcErrorResponse(error)))
      )
    );

    finish();

    if (response.status === 101) {
      return response;
    }

    const headers = new Headers(response.headers);

    for (const [key, value] of cors) {
      headers.set(key, value);
    }

    return timings.response(
      new Response(response.body, { headers, status: response.status })
    );
  },
} satisfies ExportedHandler<Env>;
