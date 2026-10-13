import { db } from "@tailorkit/db";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import type { KV } from "@tailorkit/kv";
import { createPreviewPresence } from "@tailorkit/kv";
import { and, eq } from "drizzle-orm";

import { createPreviewBuildStore } from "./preview-build-store";

const everKey = (sessionId: string) => `preview:developer-seen:${sessionId}`;
const presenceKey = (sessionId: string) =>
  `preview:developer-connection:${sessionId}`;
const endedKey = (sessionId: string) => `preview:ended:${sessionId}`;
const activeTtlSeconds = 8 * 60 * 60;

export const recordPreviewHeartbeat = async (
  kv: KV,
  sessionId: string
): Promise<boolean> =>
  await createPreviewPresence(kv).heartbeatIfActive(
    sessionId,
    {
      connectionId: sessionId,
      revision: 0,
    },
    everKey(sessionId),
    endedKey(sessionId),
    activeTtlSeconds
  );

export const endPreviewSession = async (
  kv: KV,
  sessionId: string
): Promise<void> => {
  await db
    .update(previewSession)
    .set({ endedAt: new Date(), status: "ended" })
    .where(
      and(eq(previewSession.id, sessionId), eq(previewSession.status, "active"))
    );
  await createPreviewBuildStore(kv).end(sessionId);
};

/** A developer has 75 seconds from the last heartbeat to reconnect. */
export const ensurePreviewDeveloperGrace = async (
  kv: KV,
  sessionId: string,
  expireUnseen = false
): Promise<boolean> => {
  if (
    await kv.keepPreviewSessionIfDeveloperPresent(
      presenceKey(sessionId),
      everKey(sessionId),
      endedKey(sessionId),
      activeTtlSeconds,
      expireUnseen
    )
  ) {
    return true;
  }
  await endPreviewSession(kv, sessionId);
  return false;
};

const agentAuthorizationKey = (sessionId: string) =>
  `preview:agent-authorization:${sessionId}`;

/** Bind a preview to the JWT deadline without persisting the bearer credential. */
export const recordPreviewAgentAuthorization = async (
  kv: KV,
  sessionId: string,
  expiresAt: Date
) => {
  await kv.set(agentAuthorizationKey(sessionId), String(expiresAt.getTime()), {
    ttl: Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
  });
};

/** Revocation applies to both auth methods; a JWT-authorized preview has its own expiry. */
export const previewCliCredentialActive = async (
  kv: KV,
  session: {
    id: string;
    cliToken: { revokedAt: Date | null; expiresAt: Date } | null;
  }
) => {
  if (!session.cliToken || session.cliToken.revokedAt) {
    return false;
  }
  if (session.cliToken.expiresAt > new Date()) {
    return true;
  }
  const deadline = await kv.get(agentAuthorizationKey(session.id));
  return deadline !== null && Number(deadline) > Date.now();
};
