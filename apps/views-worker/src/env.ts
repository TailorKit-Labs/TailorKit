import { appRuntimeIssuer } from "@patchsmith/api-utils/app-auth";
import { createEnv } from "@patchsmith/env";
import { z } from "zod";

import type { InstallationNamespace } from "./runtime";

const privateKey = z.object({
  crv: z.literal("P-256"),
  d: z.string().min(1),
  kid: z.string().min(1),
  kty: z.literal("EC"),
  x: z.string().min(1),
  y: z.string().min(1),
});

const fields = {
  APP_RUNTIME_SIGNING_KEY: z.string().min(1),
  ASSET_DOMAIN: z.string().min(1).default("tailorkit.app"),
  AUTH_SECRET: z.string().min(32),
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }),
  KV_REST_API_TOKEN: z.string().min(1),
  KV_REST_API_URL: z.url(),
  PLATFORM_URL: z
    .url()
    .transform(appRuntimeIssuer)
    .default("https://patchsmith.io/api/platform"),
  // oxlint-disable anti-slop/no-runtime-typeof -- Cloudflare supplies a native binding; validate its callable interface at this I/O boundary without wrapping or cloning it.
  STORES: z.custom<InstallationNamespace>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "getByName" in value &&
      typeof value.getByName === "function"
  ),
  // oxlint-enable anti-slop/no-runtime-typeof
};

// The binding object is an I/O boundary, parsed before use without changing process.env.
export const readEnv = (
  bindings: Partial<z.input<z.ZodObject<typeof fields>>>
) => {
  const env = z
    .object(fields)
    .parse(
      createEnv({ schema: fields, scope: "views-worker", values: bindings })
    );

  return {
    ...env,
    APP_RUNTIME_SIGNING_KEY: privateKey.parse(
      JSON.parse(env.APP_RUNTIME_SIGNING_KEY)
    ),
  };
};
