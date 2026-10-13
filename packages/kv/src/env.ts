import { createEnv, warnIfMissing } from "@tailorkit/env";
import * as z from "zod";

export const env = createEnv({
  schema: {
    KV_PROVIDER: z.enum(["upstash", "redis"]).optional(),
    KV_REDIS_URL: z.url({ protocol: /^rediss?$/u }).optional(),
    KV_REST_API_TOKEN: z.string().min(1).optional(),
    KV_REST_API_URL: z.url({ protocol: /^https?$/u }).optional(),
  },
  scope: "kv",
});

if (env.KV_PROVIDER === "upstash") {
  warnIfMissing("kv", {
    KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
    KV_REST_API_URL: env.KV_REST_API_URL,
  });
}
if (env.KV_PROVIDER === "redis") {
  warnIfMissing("kv", { KV_REDIS_URL: env.KV_REDIS_URL });
}
