import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { getKV } from "@tailorkit/kv";

import { env } from "#env";

import {
  endPreviewSession,
  ensurePreviewDeveloperGrace,
  previewCliCredentialActive,
} from "./preview-lifecycle";
import { previewViewerTokenExpiresAt } from "./preview-token";
import type { PreviewWebSocketContext } from "./preview-ws";

export const authorizePreviewSocket = async (
  sessionId: string,
  token: string,
  role: "uploader" | "viewer"
): Promise<PreviewWebSocketContext | null> => {
  const kv = getKV();
  if (
    !kv ||
    !(
      env.AUTH_SECRET !== undefined &&
      env.AUTH_SECRET !== null &&
      env.AUTH_SECRET !== ""
    )
  ) {
    return null;
  }
  const session = await db.query.previewSession.findFirst({
    where: { id: sessionId, status: "active" },
    with: { cliToken: true },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    !(await ensurePreviewDeveloperGrace(kv, sessionId))
  ) {
    return null;
  }
  if (role === "viewer") {
    const viewerTokenExpiresAt = previewViewerTokenExpiresAt(sessionId, token);
    return viewerTokenExpiresAt === null
      ? null
      : { role, sessionId, viewerTokenExpiresAt };
  }
  if (!(await previewCliCredentialActive(kv, session))) {
    await endPreviewSession(kv, sessionId);
    return null;
  }
  return session.tunnelTokenHash === hashSecret(token, env.AUTH_SECRET)
    ? { role, sessionId }
    : null;
};
