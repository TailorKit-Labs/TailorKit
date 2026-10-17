import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import type { AppDeploymentMetadata } from "@tailorkit/api-utils/app-auth";
import {
  APP_PUBLIC_KEYS_CACHE_SECONDS,
  appDeploymentMetadata,
} from "@tailorkit/api-utils/app-auth";
import { db } from "@tailorkit/db";
import { Effect } from "effect";
import { catch as catchEffect } from "effect/Effect";
import { z } from "zod";

import { env } from "#env";
import { o, protectedRouter, requireAppInScopes } from "#procedures";
import { appRuntimePublicKeys, issueAppRuntimeToken } from "#runtime/auth";
import { scopeSchema, scopesSchema } from "#scope";

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

// Hosts authenticate with their project key and assert membership using verified scopes.
export const runtimeSession = protectedRouter
  .meta(openapi({ method: "POST", path: "/apps/{appId}/runtime/session" }))
  .input(
    z.object({
      body: z.strictObject({
        scopes: scopesSchema,
        subjectId: z.string().min(1).max(256).optional(),
        toolUrl: z.url().refine((value) => {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === "https:" ||
              (url.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
          );
        }, "Tool URL requires HTTPS"),
      }),
      params: z.object({ appId: z.string().min(1).max(256) }),
    })
  )
  .output(
    z.object({
      body: z.object({
        expiresAt: z.number(),
        identity: z.object({
          appId: z.string(),
          appShortId: z.string(),
          deploymentId: z.string(),
          expiresAt: z.number(),
          installationId: z.string(),
          projectId: z.string(),
          projectShortId: z.string(),
          scope: scopeSchema,
          subjectId: z.string().optional(),
          toolUrl: z.url(),
        }),
        token: z.string(),
        toolUrl: z.url(),
        url: z.url(),
      }),
    })
  )
  .use(
    requireAppInScopes.adaptInput(
      ({ params: { appId }, body: { scopes } }) => ({ appId, scopes })
    )
  )
  .handler(async ({ context, input }) => {
    const deployment = context.app.currentDeployment;
    if (!deployment) {
      throw new ORPCError("NOT_FOUND", {
        message: "App has no published deployment.",
      });
    }
    const runtime = new URL(
      env.APP_RUNTIME_URL ??
        `https://${context.project.shortId}.${env.ASSET_DOMAIN ?? "tailorkit.app"}`
    );
    const localRuntime =
      runtime.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(runtime.hostname);
    if (
      runtime.username ||
      runtime.password ||
      runtime.search ||
      runtime.hash ||
      (runtime.protocol !== "https:" && !localRuntime)
    ) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Invalid app runtime configuration.",
      });
    }
    const projectPath = localRuntime ? `/p/${context.project.shortId}` : "";
    const url = new URL(`${projectPath}/a/${context.app.shortId}/rpc`, runtime);
    // Each app belongs to one installation scope. Resolve identity from the authorized
    // database record, never from browser input or the ordering of the viewer's scopes.
    const identity = {
      appId: context.app.id,
      appShortId: context.app.shortId,
      deploymentId: deployment.id,
      installationId: context.app.id,
      projectId: context.project.id,
      projectShortId: context.project.shortId,
      scope: context.app.scope,
      subjectId: input.body.subjectId,
      toolUrl: input.body.toolUrl,
    };
    const session = await issueAppRuntimeToken(identity);
    return {
      body: {
        ...session,
        identity: { ...identity, expiresAt: session.expiresAt },
        toolUrl: identity.toolUrl,
        url: url.href,
      },
    };
  });

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

/** Cache publication failures do not undo a published deployment; worker misses use the API. */
export const publishRuntimeMetadata = async (
  metadata: AppDeploymentMetadata,
  appShortId: string
) => {
  await Effect.runPromise(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unknown-in-effect-catch -- This bridge preserves the original host or transport failure for existing error-code and cancellation handling; wrapping would change observable failures.
    Effect.tryPromise({
      catch: (err) => err,
      try: async () => {
        if (
          !(
            env.APP_RUNTIME_SERVICE_TOKEN !== undefined &&
            env.APP_RUNTIME_SERVICE_TOKEN !== null &&
            env.APP_RUNTIME_SERVICE_TOKEN !== ""
          )
        ) {
          return;
        }
        const url = new URL(
          `/p/${metadata.projectId}/a/${appShortId}/new-deployment`,
          env.APP_RUNTIME_INTERNAL_URL ??
            `https://internal.${env.ASSET_DOMAIN ?? "tailorkit.app"}`
        );
        if (url.protocol !== "https:") {
          throw new Error("App runtime URL requires HTTPS");
        }
        const response = await fetch(url, {
          body: JSON.stringify(metadata),
          headers: {
            authorization: `Bearer ${env.APP_RUNTIME_SERVICE_TOKEN}`,
            "content-type": "application/json",
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(
            `Runtime metadata publication failed (${response.status})`
          );
        }
      },
    }).pipe(
      catchEffect((err) =>
        Effect.sync(() => {
          console.error("Could not publish app runtime metadata", err);
        })
      )
    )
  );
};
