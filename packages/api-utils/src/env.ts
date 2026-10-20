import { createEnv } from "@patchsmith/env";
import * as z from "zod";

export const env = createEnv({
  schema: {
    ASSET_BASE_URL: z.url().optional(),
    ASSET_DOMAIN: z.string().default("tailorkit.app"),
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    PORT: z.coerce.number().optional(),
    VERCEL: z.stringbool().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    VERCEL_URL: z.string().optional(),
  },
  scope: "api-utils",
});
