import { createEnv } from "@tailorkit/env";
import * as z from "zod";

export const env = createEnv({
  schema: {
    APP_RUNTIME_INTERNAL_URL: z.url().optional(),

    APP_RUNTIME_PREVIOUS_PUBLIC_KEYS: z.string().optional(),

    APP_RUNTIME_SERVICE_TOKEN: z.string().min(32).optional(),

    APP_RUNTIME_SIGNING_KEY: z.string().optional(),

    // Optional local runtime override; hosted URLs derive from the team and ASSET_DOMAIN.
    APP_RUNTIME_URL: z.url().optional(),

    ASSET_DOMAIN: z.string().default("tailorkit.app"),

    AUTH_SECRET: z.string().min(32).optional(),

    OPENAPI_SERVER_URL: z.url().default("https://tailorkit.dev/api/platform"),

    PORT: z.coerce.number().optional(),

    VERCEL_BRANCH_URL: z.string().optional(),

    VERCEL_ENV: z.string().optional(),

    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),

    VERCEL_URL: z.string().optional(),
  },
  scope: "api-platform",
  warnings: {
    AUTH_SECRET:
      "AUTH_SECRET is not set; authenticated platform routes will be unavailable.",
  },
});
