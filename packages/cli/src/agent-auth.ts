import { readFileSync } from "node:fs";

import { decodeJwt, decodeProtectedHeader } from "jose";
import { z } from "zod";

/** Reject insecure platform routes before a credential can be attached. */
export function validatePlatformUrl(value: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Agent platform URL must use HTTPS, except for loopback hosts."
    );
  }
  return url.href.replace(/\/$/u, "");
}

const agentClaimsSchema = z.object({
  appId: z.string().min(1),
  aud: z.literal("tailorkit-platform-cli"),
  exp: z.number().int(),
  iat: z.number().int(),
  iss: z.literal("tailorkit-agent"),
  platformUrl: z.url({ protocol: /^https?$/u }),
  projectId: z.string().min(1),
  scope: z.object({
    name: z.string().min(1),
    value: z.record(z.string(), z.json()),
  }),
});

/** Decode routing data only. The platform verifies the signature and authorization. */
export function getAgentAuth() {
  let token = process.env.TAILORKIT_AGENT_TOKEN;
  if (
    token === undefined &&
    process.env.TAILORKIT_AGENT_TOKEN_FILE !== undefined
  ) {
    try {
      token = readFileSync(
        process.env.TAILORKIT_AGENT_TOKEN_FILE,
        "utf-8"
      ).trim();
    } catch {
      throw new Error("Unable to read agent authorization file.");
    }
  }
  if (token === undefined) {
    return undefined;
  }
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "HS256" || header.typ !== "tailorkit-agent+jwt") {
      throw new Error();
    }
    const claims = agentClaimsSchema.parse(decodeJwt(token));
    const now = Math.floor(Date.now() / 1000);
    validatePlatformUrl(claims.platformUrl);
    if (
      claims.iat > now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 3600
    ) {
      throw new Error();
    }
    if (claims.exp <= now) {
      throw new Error("Agent authorization expired. Start a new agent turn.");
    }
    return { ...claims, token };
  } catch (error) {
    throw new Error(
      error instanceof Error &&
        error.message.startsWith("Agent authorization expired")
        ? error.message
        : "Invalid agent authorization. Start a new agent turn.",
      { cause: error }
    );
  }
}

export type AgentAuth = NonNullable<ReturnType<typeof getAgentAuth>>;
