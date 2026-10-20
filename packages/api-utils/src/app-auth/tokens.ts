import { AppError } from "@patchsmith/app/client";
import type { Identity } from "@patchsmith/app/server";
import { Clock, Effect } from "effect";
import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { APP_TOKEN_LIFETIME_SECONDS } from "./policy";

export type AppTokenIdentity = Omit<Identity, "expiresAt"> & {
  projectShortId: string;
  appShortId: string;
};
export type VerifiedAppTokenIdentity = Identity &
  Pick<AppTokenIdentity, "projectShortId" | "appShortId">;

export const appRuntimeIssuer = (platformUrl: string) => {
  const url = new URL(platformUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Platform URL requires HTTPS and no credentials, query or fragment"
    );
  }
  return url.href.replace(/\/$/u, "");
};

export interface AppSigningOptions {
  issuer: string;
  audience: string;
  keyId: string;
  /** ES256 private key. Keep this in the trusted issuing server only. */
  privateKey: CryptoKey | JsonWebKey;
  lifetimeSeconds?: number;
}
export interface AppTokenTrust {
  issuer: string;
  audience: string;
  appId?: string;
  projectId?: string;
  /** Trusted issuer public keys, provisioned by the operator; never read from JWT headers. */
  publicKeys: { keys: (JsonWebKey & { kid: string })[] };
}
const access = z.object({
  appId: z.string().min(1).max(256),
  appShortId: z.string().min(1).max(256),
  deploymentId: z.string().min(1).max(256),
  exp: z.number().int(),
  iat: z.number().int(),
  installationId: z.string().min(1).max(256),
  projectId: z.string().min(1).max(256),
  projectShortId: z.string().min(1).max(256),
  scope: z.object({
    name: z.string().min(1),
    value: z.record(z.string(), z.json()),
  }),
  sub: z.string().min(1).max(256),
  subjectId: z.string().min(1).max(256),
  toolUrl: z.url(),
});
const publicKeysSchema = z.object({
  keys: z
    .array(
      z.object({
        crv: z.literal("P-256"),
        d: z.never().optional(),
        kid: z.string().min(1),
        kty: z.literal("EC"),
        x: z.string().min(1),
        y: z.string().min(1),
      })
    )
    .max(32),
});

export const parseAppPublicKeys = (
  value: Parameters<typeof publicKeysSchema.parse>[0]
) => publicKeysSchema.parse(value);

class AppTokenSigningError extends Error {
  readonly _tag = "AppTokenSigningError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppTokenSigningError";
  }
}

const signingError = (cause: unknown): AppTokenSigningError =>
  new AppTokenSigningError(
    cause instanceof Error ? cause.message : "App token signing failed",
    { cause }
  );

/** Compose signing without starting a runtime; Promise callers use issueAppToken. */
export const issueAppTokenEffect = (
  options: AppSigningOptions,
  identity: AppTokenIdentity
) =>
  Effect.gen(function* issueToken() {
    const maximum = APP_TOKEN_LIFETIME_SECONDS;
    const lifetime = options.lifetimeSeconds ?? maximum;
    if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > maximum) {
      return yield* Effect.fail(
        new AppTokenSigningError(`App tokens must last 1–${maximum} seconds`)
      );
    }
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    yield* Effect.try({
      catch: signingError,
      try: () =>
        access.parse({
          appId: identity.appId,
          appShortId: identity.appShortId,
          deploymentId: identity.deploymentId,
          exp: now + lifetime,
          iat: now,
          installationId: identity.installationId,
          projectId: identity.projectId,
          projectShortId: identity.projectShortId,
          scope: identity.scope,
          sub: identity.installationId,
          subjectId: identity.subjectId,
          toolUrl: identity.toolUrl,
        }),
    });
    const key = yield* Effect.tryPromise({
      catch: signingError,
      try: async () =>
        "kty" in options.privateKey
          ? await importJWK({ ...options.privateKey, alg: "ES256" }, "ES256")
          : options.privateKey,
    });
    const token = yield* Effect.tryPromise({
      catch: signingError,
      try: async () =>
        await new SignJWT({
          appId: identity.appId,
          appShortId: identity.appShortId,
          deploymentId: identity.deploymentId,
          installationId: identity.installationId,
          projectId: identity.projectId,
          projectShortId: identity.projectShortId,
          scope: identity.scope,
          subjectId: identity.subjectId,
          toolUrl: identity.toolUrl,
        })
          .setProtectedHeader({ alg: "ES256", kid: options.keyId, typ: "JWT" })
          .setSubject(identity.installationId)
          .setIssuer(options.issuer)
          .setAudience(options.audience)
          .setIssuedAt(now)
          .setExpirationTime(now + lifetime)
          .sign(key),
    });
    return { expiresAt: (now + lifetime) * 1000, token };
  });

export const issueAppToken = async (
  options: AppSigningOptions,
  identity: AppTokenIdentity
) => await Effect.runPromise(issueAppTokenEffect(options, identity));

/** Trust configuration is checked at construction; token failures use the typed error channel. */
const invalidTokenImplementationImplementation = () =>
  new AppError("UNAUTHORIZED", "Invalid or expired app token");

export const appTokenVerifierEffect = (trust: AppTokenTrust) => {
  let publicKeys;
  try {
    publicKeys = parseAppPublicKeys(trust.publicKeys);
    if (!publicKeys.keys.length) {
      throw new Error("Missing signing keys");
    }
  } catch {
    throw new Error("Configure trusted ES256 public signing keys");
  }
  const keys = createLocalJWKSet({
    keys: publicKeys.keys.map((key) => ({ ...key, alg: "ES256", use: "sig" })),
  });
  const invalidTokenImplementation = invalidTokenImplementationImplementation;

  return (token: string): Effect.Effect<VerifiedAppTokenIdentity, AppError> =>
    Effect.gen(function* verifyToken() {
      const now = yield* Clock.currentTimeMillis;
      const invalidToken = invalidTokenImplementation;
      const { payload } = yield* Effect.tryPromise({
        catch: invalidToken,
        try: async () =>
          await jwtVerify(token, keys, {
            algorithms: ["ES256"],
            audience: trust.audience,
            currentDate: new Date(now),
            issuer: trust.issuer,
            maxTokenAge: APP_TOKEN_LIFETIME_SECONDS,
            requiredClaims: [
              "sub",
              "exp",
              "iat",
              "appId",
              "installationId",
              "projectId",
              "deploymentId",
              "projectShortId",
              "appShortId",
              "scope",
              "subjectId",
              "toolUrl",
            ],
            typ: "JWT",
          }),
      });
      const claims = yield* Effect.try({
        catch: invalidToken,
        try: () => access.parse(payload),
      });
      const verifiedAt = yield* Clock.currentTimeMillis;
      if (
        claims.sub !== claims.installationId ||
        (trust.appId !== undefined && claims.appId !== trust.appId) ||
        (trust.projectId !== undefined &&
          claims.projectId !== trust.projectId) ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > APP_TOKEN_LIFETIME_SECONDS ||
        claims.iat > Math.floor(verifiedAt / 1000) ||
        claims.exp * 1000 <= verifiedAt
      ) {
        return yield* Effect.fail(invalidToken());
      }
      return Object.freeze({
        appId: claims.appId,
        appShortId: claims.appShortId,
        deploymentId: claims.deploymentId,
        expiresAt: claims.exp * 1000,
        installationId: claims.installationId,
        projectId: claims.projectId,
        projectShortId: claims.projectShortId,
        scope: Object.freeze(claims.scope),
        subjectId: claims.subjectId,
        toolUrl: claims.toolUrl,
      });
    });
};

export const appTokenVerifier = (trust: AppTokenTrust) => {
  const verify = appTokenVerifierEffect(trust);
  return async (token: string) => await Effect.runPromise(verify(token));
};
export const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization");
  if (
    !(authorization?.startsWith("Bearer ") === true) ||
    authorization.length > 8192
  ) {
    throw new AppError("UNAUTHORIZED", "App token required");
  }
  return authorization.slice(7);
};
