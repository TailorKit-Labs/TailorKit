import { ORPCError } from "@orpc/server";
import {
  deploymentsCreate,
  deploymentsGet,
  deploymentsList,
  deploymentsPublish,
} from "@tailorkit/client-platform/client";
import { z } from "zod";

import { platformAppSelector } from "#server/platform-app-selector";
import {
  getTailorKitScope,
  getTailorKitScopes,
  o,
  requireCliDeployToken,
} from "#server/procedures";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const paginationInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const clientAssetInput = z.object({
  checksum: z.string(),
  contentLength: z.number().int().min(1),
  contentType: z.literal("application/javascript"),
  encoding: z.enum(["utf-8", "gzip"]),
  objectKey: z.literal("client.js"),
});

const serverAssetInput = clientAssetInput.extend({
  objectKey: z.literal("server.js"),
});

const logoAssetInput = z.object({
  checksum: z.string(),
  contentLength: z
    .number()
    .int()
    .min(1)
    .max(256 * 1024),
  contentType: z.enum(["image/svg+xml", "image/png", "image/webp"]),
});

const deploymentAssetsInput = z.tuple([clientAssetInput]);
const deploymentLogosInput = z
  .object({
    dark: logoAssetInput.optional(),
    light: logoAssetInput.optional(),
  })
  .optional();

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
      z.object({
        appId: z.string(),
        assets: deploymentAssetsInput,
        logos: deploymentLogosInput,
        server: serverAssetInput.optional(),
        views: z
          .array(
            z.object({
              disabled: z.literal(true).optional(),
              instances: z.literal(true).optional(),
              path: z.string().startsWith("/").max(1024),
              slot: z.string().min(1).max(255),
            })
          )
          .max(1000)
          .optional(),
      })
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentsCreate({
          body: {
            app: platformAppSelector(input.appId),
            assets: input.assets,
            logos: input.logos,
            scope: getTailorKitScope(context),
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
      z.object({
        deploymentId: z.string(),
        scopes: z.array(z.string()).optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsGet({
          body: { scopes: getTailorKitScopes(context, input.scopes) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
        })
    ),
  list: o
    .use(requireCliDeployToken)
    .input(
      z
        .object({ appId: z.string(), scopes: z.array(z.string()).optional() })
        .extend(paginationInput.shape)
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsList({
          body: {
            app: platformAppSelector(input.appId),
            page: input.page,
            pageSize: input.pageSize,
            scopes: getTailorKitScopes(context, input.scopes),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  publish: o
    .use(requireCliDeployToken)
    .input(
      z.object({
        deploymentId: z.string(),
        rollout: z.boolean().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await deploymentsPublish({
          body: { rollout: input.rollout, scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { deploymentId: input.deploymentId },
        })
    ),
};
