import { ORPCError } from "@orpc/server";
import {
  deploymentsCreate,
  deploymentsGet,
  deploymentsList,
  deploymentsPublish,
} from "@patchsmith/client-platform/client";
import * as v from "valibot";

import { platformAppSelector } from "#server/platform-app-selector";
import {
  getPatchSmithScope,
  getPatchSmithScopes,
  o,
  requireCliDeployToken,
} from "#server/procedures";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const paginationInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  pageSize: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
  ),
});

const clientAssetInput = v.object({
  checksum: v.string(),
  contentLength: v.pipe(v.number(), v.integer(), v.minValue(1)),
  contentType: v.literal("application/javascript"),
  encoding: v.picklist(["utf-8", "gzip"]),
  objectKey: v.literal("client.js"),
});

const serverAssetInput = v.object({
  ...clientAssetInput.entries,
  objectKey: v.literal("server.js"),
});

const logoAssetInput = v.object({
  checksum: v.string(),
  contentLength: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(256 * 1024)
  ),
  contentType: v.picklist(["image/svg+xml", "image/png", "image/webp"]),
});

const deploymentAssetsInput = v.tuple([clientAssetInput]);
const deploymentLogosInput = v.optional(
  v.object({
    dark: v.optional(logoAssetInput),
    light: v.optional(logoAssetInput),
  })
);

const getErrorMessage = (cause: unknown): string | undefined => {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (isStringValue(cause)) {
    return cause;
  }
  if (isObjectValue(cause) && "message" in cause) {
    const { message } = cause;
    return isStringValue(message) ? message : undefined;
  }

  return undefined;
};

const isNotFoundError = (cause: unknown): boolean =>
  getErrorMessage(cause)?.toLowerCase().includes("not found") ?? false;

const preservePlatformNotFound = (cause: unknown): never => {
  if (isNotFoundError(cause)) {
    throw new ORPCError("NOT_FOUND", { message: "App not found." });
  }

  throw cause;
};

export const deploymentRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(
      v.object({
        appId: v.string(),
        assets: deploymentAssetsInput,
        logos: deploymentLogosInput,
        server: v.optional(serverAssetInput),
        views: v.optional(
          v.pipe(
            v.array(
              v.object({
                disabled: v.optional(v.literal(true)),
                instances: v.optional(v.literal(true)),
                path: v.pipe(v.string(), v.startsWith("/"), v.maxLength(1024)),
                slot: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
              })
            ),
            v.maxLength(1000)
          )
        ),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentsCreate({
          body: {
            app: platformAppSelector(input.appId),
            assets: input.assets,
            logos: input.logos,
            scope: getPatchSmithScope(context),
            server: input.server,
            views: input.views,
          },
          client: context.platform,
          headers: context.platformHeaders,
        });
      } catch (error) {
        return preservePlatformNotFound(error);
      }
    }),
  get: o
    .use(requireCliDeployToken)
    .input(
      v.object({
        deploymentId: v.string(),
        scopes: v.optional(v.array(v.string())),
      })
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsGet({
          body: { scopes: getPatchSmithScopes(context, input.scopes) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
        })
    ),
  list: o
    .use(requireCliDeployToken)
    .input(
      v.object({
        appId: v.string(),
        scopes: v.optional(v.array(v.string())),
        ...paginationInput.entries,
      })
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsList({
          body: {
            app: platformAppSelector(input.appId),
            page: input.page,
            pageSize: input.pageSize,
            scopes: getPatchSmithScopes(context, input.scopes),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  publish: o
    .use(requireCliDeployToken)
    .input(
      v.object({
        deploymentId: v.string(),
        rollout: v.optional(v.boolean()),
      })
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsPublish({
          body: { rollout: input.rollout, scope: getPatchSmithScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
        })
    ),
};
