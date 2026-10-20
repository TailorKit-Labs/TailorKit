import { createHmac, randomUUID } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const issuer = "patchsmith-agent";
const audience = "patchsmith-platform-cli";
const lifetimeSeconds = 60 * 60;

const identitySchema = z.object({
  appId: z.string().min(1),
  cliTokenId: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.object({
    name: z.string().min(1),
    value: z.record(z.string(), z.json()),
  }),
});
const claimsSchema = identitySchema.extend({
  exp: z.number().int(),
  iat: z.number().int(),
  jti: z.string().min(1),
  platformUrl: z.url({ protocol: /^https?$/u }),
  sub: z.string().min(1),
});

const signingKey = (secret: string) => {
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET is required for agent tokens.");
  }
  return createHmac("sha256", secret)
    .update("patchsmith-agent-deploy-v1")
    .digest();
};

const normalizePlatformUrl = (value: string) => {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid agent platform URL.");
  }
  return url.href.replace(/\/$/u, "");
};

/** Issued only after the initiating CLI credential and selected app are authorized. */
export const issueAgentToken = async (
  identity: z.input<typeof identitySchema>,
  secret: string,
  platformUrl: string
) => {
  const authorized = identitySchema.parse(identity);
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    ...authorized,
    platformUrl: normalizePlatformUrl(platformUrl),
  })
    .setProtectedHeader({ alg: "HS256", typ: "patchsmith-agent+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    // CLI approval currently records no user subject; identify its credential explicitly.
    .setSubject(`cli-token:${authorized.cliTokenId}`)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(signingKey(secret));
};

export const verifyAgentToken = async (
  token: string,
  secret: string,
  platformUrl: string
) => {
  const { payload } = await jwtVerify(token, signingKey(secret), {
    algorithms: ["HS256"],
    audience,
    issuer,
    maxTokenAge: lifetimeSeconds,
    requiredClaims: ["exp", "iat", "sub", "jti"],
    typ: "patchsmith-agent+jwt",
  });
  const claims = claimsSchema.parse(payload);
  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > lifetimeSeconds ||
    claims.sub !== `cli-token:${claims.cliTokenId}` ||
    claims.platformUrl !== normalizePlatformUrl(platformUrl)
  ) {
    throw new Error("Invalid agent token claims.");
  }
  return claims;
};

export type AgentToken = Awaited<ReturnType<typeof verifyAgentToken>>;
