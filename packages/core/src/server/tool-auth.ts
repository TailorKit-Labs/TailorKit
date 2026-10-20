import * as v from "valibot";

import type { ToolIdentity } from "#schema/tools";
import { jsonValueSchema } from "#validation";

const audience = "patchsmith-app";
const decode = (part: string) =>
  Uint8Array.from(
    atob(part.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.codePointAt(0) ?? 0
  );
/** Only configured platform keys are trusted. Never follow URLs from token headers. */
export const createToolVerifier = (options: {
  platformUrl: string;
  fetch: typeof fetch;
}) => {
  const issuer = options.platformUrl.replace(/\/$/u, "");
  let cached:
    | { expiresAt: number; keys: (JsonWebKey & { kid: string })[] }
    | undefined;
  let refreshing: Promise<void> | undefined;
  let nextUnknownKeyRefresh = 0;
  const refreshKeys = async (): Promise<void> => {
    refreshing ??= (async () => {
      try {
        await (async () => {
          const response = await options.fetch(`${issuer}/runtime/keys`, {
            redirect: "manual",
          });
          if (!response.ok) {
            throw new Error("Signing keys unavailable");
          }
          const parsed = v.safeParse(
            v.object({
              keys: v.pipe(
                v.array(
                  v.looseObject({
                    crv: v.literal("P-256"),
                    d: v.optional(v.never()),
                    kid: v.pipe(v.string(), v.minLength(1)),
                    kty: v.literal("EC"),
                    x: v.pipe(v.string(), v.minLength(1)),
                    y: v.pipe(v.string(), v.minLength(1)),
                  })
                ),
                v.minLength(1),
                v.maxLength(32)
              ),
            }),
            await response.json()
          );
          if (!parsed.success) {
            throw new Error("Invalid signing keys");
          }
          const result = parsed.output;
          cached = { expiresAt: Date.now() + 60_000, keys: result.keys };
        })();
      } finally {
        refreshing = undefined;
      }
    })();
    await refreshing;
  };
  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  return async (token: string, toolUrl: string): Promise<ToolIdentity> => {
    if (token.length > 8192) {
      throw new Error("Invalid tool credential");
    }
    const parts = token.split(".");
    const [headerPart, payloadPart, signaturePart] = parts;
    if (
      parts.length !== 3 ||
      headerPart === undefined ||
      payloadPart === undefined ||
      signaturePart === undefined
    ) {
      throw new Error("Invalid tool credential");
    }
    const parsedHeader = v.safeParse(
      v.object({
        alg: v.literal("ES256"),
        crit: v.optional(
          v.union([v.literal(false), v.literal(0), v.literal(""), v.null()])
        ),
        kid: v.string(),
        typ: v.literal("JWT"),
      }),
      JSON.parse(new TextDecoder().decode(decode(headerPart)))
    );
    if (!parsedHeader.success) {
      throw new Error("Invalid tool credential");
    }
    const header = parsedHeader.output;
    let refreshed = false;
    if (!cached || cached.expiresAt <= Date.now()) {
      await refreshKeys();
      refreshed = true;
    }
    let jwk = cached?.keys.find((k) => k.kid === header.kid);
    if (!jwk && !refreshed) {
      if (refreshing) {
        await refreshing;
      } else if (Date.now() >= nextUnknownKeyRefresh) {
        nextUnknownKeyRefresh = Date.now() + 10_000;
        await refreshKeys();
      }
      jwk = cached?.keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) {
      throw new Error("Unknown signing key");
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    if (
      !(await crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        key,
        decode(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      ))
    ) {
      throw new Error("Invalid signature");
    }
    const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(256));
    const parsedClaims = v.safeParse(
      v.object({
        appId: identifier,
        appShortId: identifier,
        aud: v.literal(audience),
        deploymentId: identifier,
        exp: v.pipe(v.number(), v.integer()),
        iat: v.pipe(v.number(), v.integer()),
        installationId: identifier,
        iss: v.literal(issuer),
        projectId: identifier,
        projectShortId: identifier,
        scope: v.object({
          name: v.pipe(v.string(), v.minLength(1)),
          value: v.record(v.string(), jsonValueSchema),
        }),
        sub: v.string(),
        subjectId: identifier,
        toolUrl: v.literal(toolUrl),
      }),
      JSON.parse(new TextDecoder().decode(decode(payloadPart)))
    );
    if (!parsedClaims.success) {
      throw new Error("Invalid tool claims");
    }
    const claims = parsedClaims.output;
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.exp <= now ||
      claims.iat > now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 300 ||
      claims.sub !== claims.installationId
    ) {
      throw new Error("Invalid tool claims");
    }
    if (claims.appId !== claims.installationId) {
      throw new Error("Invalid scope identity");
    }
    return Object.freeze({
      appId: claims.appId,
      deploymentId: claims.deploymentId,
      expiresAt: claims.exp * 1000,
      installationId: claims.installationId,
      projectId: claims.projectId,
      scope: Object.freeze(claims.scope),
      subjectId: claims.subjectId,
    });
  };
};
