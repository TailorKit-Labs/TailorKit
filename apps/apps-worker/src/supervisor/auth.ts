import {
  APP_AUDIENCE,
  appRuntimeIssuer,
  appTokenVerifierEffect,
  parseAppPublicKeys,
} from "@patchsmith/api-utils/app-auth";
import { Effect } from "effect";

import { AppError } from "../runtime/errors";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

interface RuntimeVerifierOptions {
  platformUrl: string;
  publicKeys: unknown;
}

export const createAppRuntimeVerifierEffect = (
  options: RuntimeVerifierOptions
) => {
  let verify: ReturnType<typeof appTokenVerifierEffect>;
  try {
    verify = appTokenVerifierEffect({
      audience: APP_AUDIENCE,
      issuer: appRuntimeIssuer(options.platformUrl),
      publicKeys: parseAppPublicKeys(
        isStringValue(options.publicKeys)
          ? JSON.parse(options.publicKeys)
          : options.publicKeys
      ),
    });
  } catch {
    return (_token: string) =>
      Effect.fail(
        new AppError("UNAVAILABLE", "Invalid configured app public keys")
      );
  }
  return (token: string) => verify(token);
};

let cached:
  | { id: string; verify: ReturnType<typeof createAppRuntimeVerifierEffect> }
  | undefined;

export const verifier = (env: Env) => {
  const id = JSON.stringify([env.PLATFORM_URL, env.APP_RUNTIME_PUBLIC_KEYS]);

  if (cached?.id !== id) {
    cached = {
      id,
      verify: createAppRuntimeVerifierEffect({
        platformUrl: env.PLATFORM_URL,
        publicKeys: env.APP_RUNTIME_PUBLIC_KEYS,
      }),
    };
  }

  return cached.verify;
};
