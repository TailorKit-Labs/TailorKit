import { z } from "zod";

import type { ToolIdentity } from "../schema/tools";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";

const audience = "tailorkit-app";
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
  const refreshKeys = (): Promise<void> => {
    refreshing ??= (async () => {
      try {
        return await (async () => {
          const response = await options.fetch(`${issuer}/runtime/keys`, {
            redirect: "manual",
          });
          if (!response.ok) {
            throw new Error("Signing keys unavailable");
          }
          const parsed = z
            .object({
              keys: z
                .array(
                  z
                    .object({
                      crv: z.literal("P-256"),
                      d: z.never().optional(),
                      kid: z.string().min(1),
                      kty: z.literal("EC"),
                      x: z.string().min(1),
                      y: z.string().min(1),
                    })
                    .passthrough()
                )
                .min(1)
                .max(32),
            })
            .safeParse(await response.json());
          if (!parsed.success) {
            throw new Error("Invalid signing keys");
          }
          const result = parsed.data;
          cached = { expiresAt: Date.now() + 60_000, keys: result.keys };
        })();
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  };
  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  return async (token: string, toolUrl: string): Promise<ToolIdentity> => {
    if (token.length > 8192) {
      throw new Error("Invalid tool credential");
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid tool credential");
    }
    // SAFETY: Token parsing checks the three JWT segments before decoding them; their order is header, payload, and signature.
    const [headerPart, payloadPart, signaturePart] = parts as [
      string,
      string,
      string,
    ];
    const header = JSON.parse(new TextDecoder().decode(decode(headerPart)));
    if (
      header.alg !== "ES256" ||
      header.typ !== "JWT" ||
      !isStringValue(header.kid) ||
      header.crit
    ) {
      throw new Error("Invalid tool credential");
    }
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
    const claims = JSON.parse(new TextDecoder().decode(decode(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== issuer ||
      claims.aud !== audience ||
      claims.toolUrl !== toolUrl ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.iat) ||
      claims.exp <= now ||
      claims.iat > now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 300 ||
      claims.sub !== claims.installationId
    ) {
      throw new Error("Invalid tool claims");
    }
    for (const name of [
      "installationId",
      "appId",
      "projectId",
      "deploymentId",
      "publicTeamId",
      "appPublicId",
    ]) {
      if (
        !isStringValue(claims[name]) ||
        !claims[name] ||
        claims[name].length > 256
      ) {
        throw new Error("Invalid installation identity");
      }
    }
    if (
      claims.appId !== claims.installationId ||
      (claims.subjectId !== undefined &&
        (!isStringValue(claims.subjectId) ||
          !claims.subjectId ||
          claims.subjectId.length > 256)) ||
      !claims.scope ||
      !isStringValue(claims.scope.name) ||
      !claims.scope.name ||
      !claims.scope.value ||
      !isObjectValue(claims.scope.value) ||
      Array.isArray(claims.scope.value)
    ) {
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
