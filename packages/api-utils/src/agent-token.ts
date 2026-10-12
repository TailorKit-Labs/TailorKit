import { createHmac, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const issuer = "tailorkit-agent";
const audience = "tailorkit-platform-cli";
const lifetimeSeconds = 60 * 60;

const identitySchema = z.object({
  projectId: z.string().min(1),
  appId: z.string().min(1),
  cliTokenId: z.string().min(1),
  scope: z.object({ name: z.string().min(1), value: z.record(z.string(), z.json()) }),
});
const claimsSchema = identitySchema.extend({
  platformUrl: z.url({ protocol: /^https?$/u }),
  sub: z.string().min(1),
  jti: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

function signingKey(secret: string) {
  if (secret.length < 32) throw new Error("AUTH_SECRET is required for agent tokens.");
  return createHmac("sha256", secret).update("tailorkit-agent-deploy-v1").digest();
}

function normalizePlatformUrl(value: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid agent platform URL.");
  return url.href.replace(/\/$/u, "");
}

/** Issued only after the initiating CLI credential and selected app are authorized. */
export async function issueAgentToken(
  identity: z.input<typeof identitySchema>,
  secret: string,
  platformUrl: string,
) {
  const authorized = identitySchema.parse(identity);
  const now = Math.floor(Date.now() / 1000);
  return (
    new SignJWT({ ...authorized, platformUrl: normalizePlatformUrl(platformUrl) })
      .setProtectedHeader({ alg: "HS256", typ: "tailorkit-agent+jwt" })
      .setIssuer(issuer)
      .setAudience(audience)
      // CLI approval currently records no user subject; identify its credential explicitly.
      .setSubject(`cli-token:${authorized.cliTokenId}`)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + lifetimeSeconds)
      .sign(signingKey(secret))
  );
}

export async function verifyAgentToken(token: string, secret: string, platformUrl: string) {
  const { payload } = await jwtVerify(token, signingKey(secret), {
    algorithms: ["HS256"],
    typ: "tailorkit-agent+jwt",
    issuer,
    audience,
    maxTokenAge: lifetimeSeconds,
    requiredClaims: ["exp", "iat", "sub", "jti"],
  });
  const claims = claimsSchema.parse(payload);
  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > lifetimeSeconds ||
    claims.sub !== `cli-token:${claims.cliTokenId}` ||
    claims.platformUrl !== normalizePlatformUrl(platformUrl)
  )
    throw new Error("Invalid agent token claims.");
  return claims;
}

export type AgentToken = Awaited<ReturnType<typeof verifyAgentToken>>;
