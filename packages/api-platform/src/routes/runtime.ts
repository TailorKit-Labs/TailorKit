import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import {
  APP_PUBLIC_KEYS_CACHE_SECONDS,
  appDeploymentMetadata,
} from "@patchsmith/api-utils/app-auth";
import { db } from "@patchsmith/db";
import { z } from "zod";

import { appSelectorSchema } from "#app-selector";
import type { Context } from "#context";
import { env } from "#env";
import { o, protectedRouter, requireAppInScopes } from "#procedures";
import { appRuntimePublicKeys, issueAppRuntimeToken } from "#runtime/auth";
import {
  createRuntimeSessionWith,
  runtimeViewerSchema,
  runtimeSessionSchema,
} from "#runtime/session";
import type { RuntimeApp } from "#runtime/session";
import { scopesSchema } from "#scope";

export { runtimeSessionSchema, runtimeViewerSchema } from "#runtime/session";

export const appRuntimeKeysResponse = (): ReturnType<typeof Response.json> => {
  try {
    return Response.json(appRuntimePublicKeys(), {
      headers: {
        "cache-control": `public, max-age=${APP_PUBLIC_KEYS_CACHE_SECONDS}`,
      },
    });
  } catch {
    return new Response("Signing keys unavailable", {
      headers: { "cache-control": "no-store" },
      status: 503,
    });
  }
};

/** Public routes must be dispatched before constructing the authenticated platform context. */
export const handlePublicRuntimeRequest = (
  request: Request
): Response | undefined => {
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname !== "/api/platform/runtime/keys"
  ) {
    return undefined;
  }

  return appRuntimeKeysResponse();
};

export const createRuntimeSession = async (
  context: Pick<Context, "project">,
  app: RuntimeApp,
  input: z.infer<typeof runtimeViewerSchema>
) =>
  await createRuntimeSessionWith(context, app, input, {
    assetDomain: env.ASSET_DOMAIN ?? "tailorkit.app",
    issueToken: issueAppRuntimeToken,
    runtimeUrl: env.APP_RUNTIME_URL,
  });

// Hosts authenticate with their project key and assert membership using verified scopes.
export const runtimeSession = protectedRouter
  .meta(openapi({ method: "POST", path: "/apps/runtime/session" }))
  .input(
    z.object({
      body: runtimeViewerSchema
        .extend({
          app: appSelectorSchema,
          scopes: scopesSchema,
        })
        .strict(),
    })
  )
  .output(z.object({ body: runtimeSessionSchema }))
  .use(requireAppInScopes.adaptInput(({ body }) => body))
  .handler(async ({ context, input }) => ({
    body: await createRuntimeSession(context, context.app, input.body),
  }));

// Trusted runtime metadata: return the authorized private R2 key without minting a download URL.
export const getRuntimeBundle = protectedRouter
  .meta(openapi({ method: "POST", path: "/apps/{appId}/runtime" }))
  .input(
    z.object({ body: z.object({}), params: z.object({ appId: z.string() }) })
  )
  .output(z.object({ body: appDeploymentMetadata }))
  .use(
    o
      .middleware(async ({ context, next }, input: { appId: string }) => {
        if (!(context.runtimeService === true)) {
          throw new ORPCError("FORBIDDEN");
        }

        const app = await db.query.app.findFirst({
          where: { id: input.appId, projectId: context.project.id },
          with: {
            currentDeployment: {
              where: { status: "published" },
              with: { app: { columns: { shortId: true } } },
            },
          },
        });

        if (!app) {
          throw new ORPCError("NOT_FOUND");
        }

        return await next({ context: { ...context, app } });
      })
      .adaptInput(({ params }) => ({ appId: params.appId }))
  )
  .handler(async ({ context }) => {
    const deployment = context.app.currentDeployment;

    if (!deployment) {
      throw new ORPCError("NOT_FOUND");
    }

    const assetAppId = deployment.app?.shortId ?? context.app.shortId;
    const key = `projects/${context.project.shortId}/apps/${assetAppId}/deployments/${deployment.shortId}/server/server.js`;

    const file = await db.query.appDeploymentFile.findFirst({
      where: {
        appDeploymentId: deployment.id,
        objectKey: key,
        status: "verified",
      },
    });

    if (
      !(
        file?.checksum !== undefined &&
        file?.checksum !== null &&
        file?.checksum !== ""
      )
    ) {
      throw new ORPCError("NOT_FOUND");
    }

    return {
      body: {
        appId: context.app.id,
        checksum: file.checksum,
        contentEncoding: file.encoding === "gzip" ? "gzip" : undefined,
        contentLength: file.contentLength,
        deploymentId: deployment.id,
        objectKey: file.objectKey,
        projectId: context.project.id,
      },
    };
  });

/** Enqueue independently retryable warm-up steps after deployment selection. */
export const publishRuntimeMetadata = async (
  metadata: AppDeploymentMetadata,
  _appShortId: string
) => {
  if (env.APP_RUNTIME_SERVICE_TOKEN === undefined) {
    return;
  }

  try {
    const [{ start }, { warmAppDeployment }] = await Promise.all([
      import("workflow/api"),
      import("#runtime/deployment-workflow"),
    ]);

    await start(warmAppDeployment, [
      {
        appId: metadata.appId,
        deploymentId: metadata.deploymentId,
        projectId: metadata.projectId,
      },
    ]);
  } catch (error) {
    // Publication remains usable: new token hints synchronously discover its code.
    console.error("Could not enqueue app deployment warm-up", error);
  }
};
