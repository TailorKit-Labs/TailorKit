import * as z from "zod";
import { createEnv } from "@tailorkit/env";

export const env = createEnv({
  scope: "api",
  schema: {
    VERCEL_ENV: z.string().optional(),
    VITE_POSTHOG_HOST: z.url().optional(),
    VITE_POSTHOG_PROJECT_TOKEN: z.string().optional(),
  },
});
