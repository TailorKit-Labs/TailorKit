import { randomBytes } from "node:crypto";

import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { db } from "@tailorkit/db";
import { getBaseUrl } from "@tailorkit/env";
import { getKV } from "@tailorkit/kv";
import { z } from "zod";

import { withAppAssetUrl } from "#asset-url";
import { env } from "#env";
import { forEachSequential } from "#for-each-sequential";
import { createPreviewBuildStore } from "#preview-build-store";
import { ensurePreviewDeveloperGrace } from "#preview-lifecycle";
import { createPreviewViewerToken } from "#preview-token";
import { protectedRouter } from "#procedures";
import {
  canonicalizeScope,
  canonicalizeScopes,
  scopeMatches,
  scopeSchema,
  scopesSchema,
} from "#scope";

import { AppWithCurrentDeployment } from "./apps";

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const createId = () => randomBytes(32).toString("base64url");
const grantKey = (id: string) => `preview:grant:${id}`;
const requireKV = () => {
  const kv = getKV();
  if (!kv) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Preview storage is unavailable: configure KV.",
    });
  }
  return kv;
};

const grantSchema = z.object({
  projectId: z.string().min(1),
  scope: scopeSchema,
  sessionId: z.uuid(),
});
type Grant = z.infer<typeof grantSchema>;

export const invitation = protectedRouter
  .meta(openapi({ method: "GET", path: "/shares/{shareId}" }))
  .input(z.object({ params: z.object({ shareId: opaqueId }) }))
  .output(
    z.object({
      body: z.object({
        appName: z.string(),
        expiresAt: z.date(),
        sessionId: z.uuid(),
      }),
    })
  )
  .handler(async ({ context, input }) => {
    requireKV();
    const session = await db.query.previewSession.findFirst({
      where: {
        projectId: context.project.id,
        shareId: input.params.shareId,
        status: "active",
      },
      with: { app: true },
    });
    if (
      !session ||
      !session.app ||
      session.expiresAt <= new Date() ||
      !(await ensurePreviewDeveloperGrace(requireKV(), session.id))
    ) {
      throw new ORPCError("NOT_FOUND");
    }
    return {
      body: {
        appName: session.app.name,
        expiresAt: session.expiresAt,
        sessionId: session.id,
      },
    };
  });

export const accept = protectedRouter
  .meta(openapi({ method: "POST", path: "/shares/{shareId}/accept" }))
  .input(
    z.object({
      body: z.object({ scope: scopeSchema }),
      params: z.object({ shareId: opaqueId }),
    })
  )
  .output(
    z.object({ body: z.object({ grantId: opaqueId, sessionId: z.uuid() }) })
  )
  .handler(async ({ context, input }) => {
    const kv = requireKV();
    const scope = canonicalizeScope(input.body.scope);
    const session = await db.query.previewSession.findFirst({
      where: {
        projectId: context.project.id,
        shareId: input.params.shareId,
        status: "active",
      },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !(await ensurePreviewDeveloperGrace(kv, session.id))
    ) {
      throw new ORPCError("NOT_FOUND");
    }
    const grantId = createId();
    const ttl = Math.max(
      1,
      Math.min(
        24 * 60 * 60,
        Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000)
      )
    );
    await kv.set(
      grantKey(grantId),
      JSON.stringify({
        projectId: context.project.id,
        scope: scope.scope,
        sessionId: session.id,
      } satisfies Grant),
      { ttl }
    );
    return { body: { grantId, sessionId: session.id } };
  });

const previewMetadata = z.object({
  expiresAt: z.date(),
  sessionId: z.uuid(),
  token: z.string(),
  websocketUrl: z.url(),
});

export const accepted = protectedRouter
  .meta(openapi({ method: "POST", path: "/grants/resolve" }))
  .input(
    z.object({
      body: z.object({
        grantIds: z.array(opaqueId).max(20),
        scopes: scopesSchema,
      }),
    })
  )
  .output(
    z.object({
      body: z.object({
        items: z.array(
          z.object({
            app: AppWithCurrentDeployment,
            preview: previewMetadata,
          })
        ),
      }),
    })
  )
  .handler(async ({ context, input }) => {
    const kv = requireKV();
    const scopes = canonicalizeScopes(input.body.scopes);
    const items: {
      app: z.output<typeof AppWithCurrentDeployment>;
      preview: z.output<typeof previewMetadata>;
    }[] = [];
    const seen = new Set<string>();
    await forEachSequential(input.body.grantIds, async (grantId) => {
      const raw = await kv.get(grantKey(grantId));
      if (!(raw !== undefined && raw !== null && raw !== "")) {
        return;
      }
      let grant: Grant;
      try {
        grant = grantSchema.parse(JSON.parse(raw));
      } catch {
        return;
      }
      if (
        grant.projectId !== context.project.id ||
        !scopes.some(({ scope }) => scopeMatches(grant.scope, scope))
      ) {
        return;
      }

      const session = await db.query.previewSession.findFirst({
        where: {
          id: grant.sessionId,
          projectId: context.project.id,
          status: "active",
        },
        with: {
          app: {
            with: {
              currentDeployment: {
                where: { status: "published" },
                with: { app: { columns: { publicId: true } } },
              },
            },
          },
        },
      });
      if (
        !session?.app ||
        session.expiresAt <= new Date() ||
        seen.has(session.app.id) ||
        !(await ensurePreviewDeveloperGrace(kv, session.id))
      ) {
        return;
      }
      seen.add(session.app.id);
      const websocketUrl = new URL(
        "/api/platform/preview/ws",
        getBaseUrl(env).replace(/^http/u, "ws")
      );
      websocketUrl.searchParams.set("session", session.id);
      websocketUrl.searchParams.set("role", "viewer");

      const build = await createPreviewBuildStore(kv).current(session.id);
      const app = withAppAssetUrl(
        session.app,
        context.organization.publicId,
        context.project.id
      );
      // Until the first build arrives, the published deployment remains the fallback.
      if (build?.manifest.views !== undefined) {
        app.views = build.manifest.views;
      }
      items.push({
        app,
        preview: {
          expiresAt: session.expiresAt,
          sessionId: session.id,
          token: createPreviewViewerToken(session.id),
          websocketUrl: websocketUrl.href,
        },
      });
    });
    return { body: { items } };
  });

export const previewGrantRoutes = { accept, accepted, invitation };
