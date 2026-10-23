import { ORPCError } from "@orpc/server";
import type { Session } from "@patchsmith/app/client/connection";
import { Clock, Effect } from "effect";
import { z } from "zod";

import { scopesSchema } from "#scope";

import { AppWithCurrentDeployment } from "./discovery";
import type { discoverApps } from "./discovery";
import { runtimeViewerSchema } from "./session";
import {
  resolveRuntimeViews,
  runtimeViewContexts,
  runtimeViewWarning,
} from "./view-resolution";
import { ViewResolutionTimings } from "./view-timing";

export const runtimeResolveInput = z.strictObject({
  ...runtimeViewerSchema.shape,
  appIds: z.array(z.string().min(1).max(256)).optional(),
  contexts: runtimeViewContexts,
  scopes: scopesSchema,
  slot: z.string().min(1).max(255),
});

export const runtimeResolveOutput = z.object({
  body: z.discriminatedUnion("status", [
    z.object({ status: z.literal("loading") }),
    z.object({
      data: z.array(
        z.object({
          app: AppWithCurrentDeployment,
          data: z.unknown(),
          key: z.string(),
          metadata: z.record(z.string(), z.unknown()),
        })
      ),
      status: z.literal("ready"),
      warnings: z.array(runtimeViewWarning),
    }),
  ]),
  headers: z.object({
    "cache-control": z.literal("no-store"),
    "server-timing": z.string(),
  }),
});

export type RuntimeResolveInput = z.infer<typeof runtimeResolveInput>;

export type DiscoveredApp = Awaited<ReturnType<typeof discoverApps>>[number];

export const resolveAppViews = (
  input: RuntimeResolveInput,
  options: {
    discover: (
      input: Parameters<typeof discoverApps>[2]
    ) => ReturnType<typeof discoverApps>;
    assets: (app: DiscoveredApp) => z.infer<typeof AppWithCurrentDeployment>;
    session: (
      app: z.infer<typeof AppWithCurrentDeployment>,
      input: RuntimeResolveInput
    ) => Promise<Session>;
    fetch?: typeof fetch;
  }
) =>
  Effect.gen(function* resolveAppViewsRequest() {
    const discoveryStarted = yield* Clock.currentTimeMillis;
    const apps = new Map<string, z.infer<typeof AppWithCurrentDeployment>>();
    let page = 1;
    const pageSize = 100;

    for (;;) {
      const currentPage = page;

      const installations = yield* Effect.tryPromise({
        catch: (cause) =>
          new ORPCError("INTERNAL_SERVER_ERROR", {
            cause,
            message: "Unable to discover views",
          }),
        try: async () =>
          await options.discover({
            ...input,
            page: currentPage,
            pageSize,
          }),
      });

      for (const appValue of installations.slice(0, pageSize)) {
        apps.set(appValue.id, options.assets(appValue));
      }

      if (installations.length <= pageSize) {
        break;
      }

      page += 1;
    }

    const instancesStarted = yield* Clock.currentTimeMillis;
    const discoveryMs = instancesStarted - discoveryStarted;
    const runtimeTimings = new ViewResolutionTimings(options.fetch);

    const result = yield* resolveRuntimeViews([...apps.values()], input, {
      createSession: async (appValue) =>
        await runtimeTimings.session(
          async () => await options.session(appValue, input)
        ),
      fetch: runtimeTimings.fetch,
    });

    const instancesMs = (yield* Clock.currentTimeMillis) - instancesStarted;

    return {
      body: result,
      headers: {
        "cache-control": "no-store" as const,
        "server-timing": [
          `views_discovery;dur=${discoveryMs.toFixed(1)}`,
          `views_instances;dur=${instancesMs.toFixed(1)}`,
          runtimeTimings.header(),
        ]
          .filter(Boolean)
          .join(", "),
      },
    };
  });
