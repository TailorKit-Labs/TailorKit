import { createEnv } from "@patchsmith/env";
import * as z from "zod";

export const env = createEnv({
  schema: {
    VERCEL_DEPLOYMENT_ID: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    VERCEL_SKEW_PROTECTION_ENABLED: z.string().optional(),
  },
  scope: "web",
});
