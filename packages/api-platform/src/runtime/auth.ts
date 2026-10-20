import { createPrivateKey, createPublicKey } from "node:crypto";

import type { AppTokenIdentity } from "@patchsmith/api-utils/app-auth";
import {
  APP_AUDIENCE,
  appRuntimeIssuer,
  issueAppToken,
  parseAppPublicKeys,
} from "@patchsmith/api-utils/app-auth";
import { z } from "zod";

import { env } from "#env";

const signingKey = () => {
  if (
    !(
      env.APP_RUNTIME_SIGNING_KEY !== undefined &&
      env.APP_RUNTIME_SIGNING_KEY !== null &&
      env.APP_RUNTIME_SIGNING_KEY !== ""
    )
  ) {
    throw new Error(
      "APP_RUNTIME_SIGNING_KEY is required for app runtime tokens"
    );
  }

  const parsed = z
    .object({
      crv: z.literal("P-256"),
      d: z.string().min(1),
      kid: z.string().min(1),
      kty: z.literal("EC"),
      x: z.string().min(1),
      y: z.string().min(1),
    })
    .loose()
    .safeParse(JSON.parse(env.APP_RUNTIME_SIGNING_KEY));

  if (!parsed.success) {
    throw new Error("Configure an ES256 private JWK with a kid");
  }

  const key = parsed.data;

  return key;
};

export const appRuntimePublicKeys = () => {
  const key = signingKey();

  const publicKey = createPublicKey(
    createPrivateKey({ format: "jwk", key })
  ).export({
    format: "jwk",
  });

  // Publish retired public keys for at least six minutes after rotation (token + cache lifetime).
  let previous;

  try {
    previous = parseAppPublicKeys(
      JSON.parse(env.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS ?? '{"keys":[]}')
    );
  } catch {
    throw new Error("Previous signing keys must be public ES256 keys");
  }

  return {
    keys: [
      { ...publicKey, alg: "ES256", kid: key.kid, use: "sig" },
      ...previous.keys,
    ],
  };
};

export const issueAppRuntimeToken = async (identity: AppTokenIdentity) => {
  const key = signingKey();

  return await issueAppToken(
    {
      audience: APP_AUDIENCE,
      issuer: appRuntimeIssuer(
        env.OPENAPI_SERVER_URL ?? "https://patchsmith.io/api/platform"
      ),
      keyId: key.kid,
      privateKey: key,
    },
    identity
  );
};
