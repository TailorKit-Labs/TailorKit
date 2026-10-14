import { createEnv } from "@tailorkit/env";
import { z } from "zod";

export const env = createEnv({
  schema: {
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_BASE_URL: z.url().optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
    ANTHROPIC_BASE_URL: z.url().optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.url().optional(),
    VERCEL_OIDC_TOKEN: z.string().min(1).optional(),
  },
  scope: "agent",
});
