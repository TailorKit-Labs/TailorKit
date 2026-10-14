import { timingSafeEqual } from "node:crypto";

import { hashSecret } from "@tailorkit/api-utils/hashing";
import { z } from "zod";

import { env } from "#env";

const viewerTokenLifetimeMs = 5 * 60 * 1000;

const tokenSchema = z.tuple([
  z.coerce.number().int().positive(),
  z.string().min(1),
]);

const getSigningSecret = (): string => {
  if (
    !(
      env.AUTH_SECRET !== undefined &&
      env.AUTH_SECRET !== null &&
      env.AUTH_SECRET !== ""
    )
  ) {
    throw new Error("AUTH_SECRET is required for preview tokens.");
  }
  return env.AUTH_SECRET;
};

const signature = (sessionId: string, expiresAt: number): string =>
  hashSecret(`${sessionId}.${expiresAt}`, getSigningSecret());

/** A short-lived, bearer URL credential for an already scope-authorized preview asset request. */
export const createPreviewViewerToken = (
  sessionId: string,
  now = Date.now()
): string => {
  const expiresAt = now + viewerTokenLifetimeMs;
  return `${expiresAt}.${signature(sessionId, expiresAt)}`;
};

export const previewViewerTokenExpiresAt = (
  sessionId: string,
  token: string,
  now = Date.now()
): number | null => {
  const parsed = tokenSchema.safeParse(token.split("."));
  if (!parsed.success) {
    return null;
  }
  const [expiresAt, receivedSignature] = parsed.data;
  if (expiresAt <= now) {
    return null;
  }

  const expectedSignature = signature(sessionId, expiresAt);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  return received.length === expected.length &&
    timingSafeEqual(received, expected)
    ? expiresAt
    : null;
};

export const verifyPreviewViewerToken = (
  sessionId: string,
  token: string,
  now = Date.now()
): boolean => previewViewerTokenExpiresAt(sessionId, token, now) !== null;
