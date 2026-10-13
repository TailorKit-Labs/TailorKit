import { randomBytes } from "node:crypto";

import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import { project } from "@tailorkit/db/schema/project";
import { getBaseUrl } from "@tailorkit/env";
import { getKV } from "@tailorkit/kv";
import { and, count, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { env } from "#env";

import { authenticateCliRequest } from "../cli-token";
import { createPreviewBuildStore } from "../preview-build-store";
import {
  ensurePreviewDeveloperGrace,
  recordPreviewAgentAuthorization,
} from "../preview-lifecycle";
import { o, cliRouter } from "../procedures";
import { previewGrantRoutes } from "./preview-grants";

const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const previewSessionLifetimeMs = 8 * 60 * 60 * 1000;
const firstConnectionGraceMs = 2 * 60 * 1000;
const maxActivePreviewsPerScope = 5;
const activePreviewConflictReason = "ACTIVE_PREVIEW_EXISTS";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const hash = (value: string): string => {
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required for preview credentials.");
  }
  return hashSecret(value, env.AUTH_SECRET);
};

const createSecret = (): string => randomBytes(32).toString("base64url");

const startPreview = cliRouter
  .meta(openapi({ method: "POST", path: "/start" }))
  .input(
    z.object({
      body: z.object({
        appId: z.string().min(1),
        deployToken: z.string().min(1),
        replaceActive: z.boolean().optional(),
      }),
    })
  )
  .output(
    z.object({
      body: z.object({
        expiresAt: z.date(),
        sessionId: z.string(),
        shareId: z.string(),
        tunnelToken: z.string(),
        tunnelUrl: z.url(),
      }),
    })
  )
  .handler(async ({ context, input }) => {
    const kv = getKV();
    if (!kv) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Preview storage is unavailable: configure KV.",
      });
    }
    const now = new Date();
    const token = await authenticateCliRequest(context, input.body.deployToken);

    const previewApp = await db.query.app.findFirst({
      where: {
        RAW: (fields, { and: andValue, eq: eqValue }) =>
          requireValue(
            andValue(
              eqValue(fields.projectId, context.project.id),
              eqValue(fields.scopeKey, token.scopeKey),
              eqValue(fields.scope, token.scope),
              uuidPattern.test(input.body.appId)
                ? eqValue(fields.id, input.body.appId)
                : eqValue(fields.publicId, input.body.appId)
            )
          ),
      },
    });
    if (!previewApp) {
      throw new ORPCError("NOT_FOUND", {
        message: "App not found for this host scope.",
      });
    }

    const activeSessions = await db.query.previewSession.findMany({
      where: {
        RAW: (fields, { and: andValue2, eq: eqValue2 }) =>
          requireValue(
            andValue2(
              eqValue2(fields.projectId, context.project.id),
              eqValue2(fields.scopeKey, token.scopeKey),
              eqValue2(fields.scope, token.scope),
              eqValue2(fields.status, "active")
            )
          ),
      },
    });
    for (const activeSession of activeSessions) {
      if (activeSession.expiresAt > now) {
        // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
        await ensurePreviewDeveloperGrace(
          kv,
          activeSession.id,
          activeSession.createdAt.getTime() + firstConnectionGraceMs <=
            now.getTime()
        );
      }
    }

    const tunnelToken = createSecret();
    const shareId = createSecret();
    const expiresAt = context.agentToken
      ? new Date(context.agentToken.exp * 1000)
      : new Date(now.getTime() + previewSessionLifetimeMs);
    const started = await db
      .transaction(async (tx) => {
        // Serialize starts in this project so concurrent app starts cannot exceed the scope cap.
        await tx
          .select({ id: project.id })
          .from(project)
          .where(eq(project.id, context.project.id))
          .for("update");
        const expiredSessions = await tx
          .update(previewSession)
          .set({ endedAt: now, status: "ended" })
          .where(
            and(
              eq(previewSession.projectId, context.project.id),
              eq(previewSession.scopeKey, token.scopeKey),
              eq(previewSession.scope, token.scope),
              eq(previewSession.status, "active"),
              lt(previewSession.expiresAt, now)
            )
          )
          .returning({ id: previewSession.id });
        const active = await tx.query.previewSession.findFirst({
          where: {
            appId: previewApp.id,
            status: "active",
          },
        });
        if (active && !input.body.replaceActive) {
          throw new ORPCError("CONFLICT", {
            data: { reason: activePreviewConflictReason },
            message: "A preview is already running for this app.",
          });
        }
        const replacedSessions = active
          ? await tx
              .update(previewSession)
              .set({ endedAt: now, status: "ended" })
              .where(
                and(
                  eq(previewSession.id, active.id),
                  eq(previewSession.status, "active")
                )
              )
              .returning({ id: previewSession.id })
          : [];
        const [scopeCount] = await tx
          .select({ total: count() })
          .from(previewSession)
          .where(
            and(
              eq(previewSession.projectId, context.project.id),
              eq(previewSession.scopeKey, token.scopeKey),
              eq(previewSession.scope, token.scope),
              eq(previewSession.status, "active")
            )
          );
        if ((scopeCount?.total ?? 0) >= maxActivePreviewsPerScope) {
          throw new ORPCError("CONFLICT", {
            message: `This scope already has ${maxActivePreviewsPerScope} active previews.`,
          });
        }
        const [created] = await tx
          .insert(previewSession)
          .values({
            appId: previewApp.id,
            cliTokenId: token.id,
            expiresAt,
            projectId: context.project.id,
            scope: token.scope,
            scopeKey: token.scopeKey,
            shareId,
            tunnelTokenHash: hash(tunnelToken),
          })
          .returning({ id: previewSession.id });
        return { expiredSessions, replacedSessions, session: created };
      })
      .catch((error: ErrorOptions["cause"]) => {
        if (error instanceof ORPCError) {
          throw error;
        }
        const candidate =
          error && isObjectValue(error) && "cause" in error
            ? error.cause
            : error;
        if (
          candidate &&
          isObjectValue(candidate) &&
          "code" in candidate &&
          candidate.code === "23505"
        ) {
          throw new ORPCError("CONFLICT", {
            data: { reason: activePreviewConflictReason },
            message: "A preview is already running for this app.",
          });
        }
        throw error;
      });
    if (!started.session) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create preview.",
      });
    }
    if (context.agentToken) {
      await recordPreviewAgentAuthorization(kv, started.session.id, expiresAt);
    }
    const builds = createPreviewBuildStore(kv);
    for (const ended of [
      ...started.expiredSessions,
      ...started.replacedSessions,
    ]) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
        await builds.end(ended.id);
      } catch {
        // Existing KV TTLs bound cleanup if the store is temporarily unavailable.
      }
    }

    const baseUrl = getBaseUrl(env).replace(/^http/u, "ws");
    const tunnelUrl = new URL("/api/platform/preview/ws", baseUrl);
    tunnelUrl.searchParams.set("session", started.session.id);
    return {
      body: {
        expiresAt,
        sessionId: started.session.id,
        shareId,
        tunnelToken,
        tunnelUrl: tunnelUrl.href,
      },
    };
  });

const stopPreview = cliRouter
  .meta(openapi({ method: "POST", path: "/{sessionId}/stop" }))
  .input(
    z.object({
      body: z.object({ deployToken: z.string().min(1) }),
      params: z.object({ sessionId: z.uuid() }),
    })
  )
  .output(z.object({ body: z.object({}) }))
  .handler(async ({ context, input }) => {
    const token = await authenticateCliRequest(context, input.body.deployToken);

    const [endedSession] = await db
      .update(previewSession)
      .set({ endedAt: new Date(), status: "ended" })
      .where(
        and(
          eq(previewSession.id, input.params.sessionId),
          eq(previewSession.projectId, context.project.id),
          eq(previewSession.cliTokenId, token.id),
          eq(previewSession.scopeKey, token.scopeKey),
          eq(previewSession.scope, token.scope),
          eq(previewSession.status, "active")
        )
      )
      .returning({ id: previewSession.id });
    const alreadyEnded = endedSession
      ? null
      : await db.query.previewSession.findFirst({
          where: {
            RAW: (fields, { and: andValue3, eq: eqValue3 }) =>
              requireValue(
                andValue3(
                  eqValue3(fields.id, input.params.sessionId),
                  eqValue3(fields.projectId, context.project.id),
                  eqValue3(fields.cliTokenId, token.id),
                  eqValue3(fields.scopeKey, token.scopeKey),
                  eqValue3(fields.scope, token.scope),
                  eqValue3(fields.status, "ended")
                )
              ),
          },
        });
    const sessionId = endedSession?.id ?? alreadyEnded?.id;
    if (!sessionId) {
      throw new ORPCError("NOT_FOUND", {
        message: "Preview session is unavailable.",
      });
    }
    const kv = getKV();
    if (kv) {
      await createPreviewBuildStore(kv).end(sessionId);
    }
    return { body: {} };
  });

export const previewRouter = o
  .meta(openapi({ prefix: "/preview" }))
  .router({ start: startPreview, stop: stopPreview, ...previewGrantRoutes });
