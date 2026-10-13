import { ratelimit } from "@orpc/ratelimit";
import type { RateLimiter } from "@orpc/ratelimit";
import { BaseRedisRateLimiter } from "@orpc/ratelimit/base-redis";
import { MemoryRateLimiter } from "@orpc/ratelimit/memory";
import { UpstashRateLimiter } from "@orpc/ratelimit/upstash";
import type { Context, MiddlewareOptions } from "@orpc/server";
import { getKV } from "@tailorkit/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

import { env } from "#env";

export { RateLimitHandlerPlugin } from "@orpc/ratelimit";

export function createRateLimiter({
  maxRequests,
  window,
}: {
  maxRequests: number;
  window: number;
}): RateLimiter {
  const kv = getKV();

  if (kv?.type === "upstash") {
    const upstashRatelimit = new Ratelimit({
      limiter: Ratelimit.slidingWindow(maxRequests, `${window} ms`),
      prefix: "tailorkit:ratelimit:",
      redis: kv.engine,
    });
    return new UpstashRateLimiter(upstashRatelimit, {
      waitUntil: env.VERCEL ? vercelWaitUntil : undefined,
    });
  }

  if (kv?.type === "redis") {
    const redis = kv.engine;
    // Keep the shared ioredis connection through oRPC's Redis adapter base.
    class IORedisRateLimiter extends BaseRedisRateLimiter {
      protected evalScript(
        script: string,
        keys: string[],
        args: string[]
      ): Promise<unknown> {
        return redis.eval(script, keys.length, ...keys, ...args);
      }
    }

    return new IORedisRateLimiter({
      maxRequests,
      prefix: "tailorkit:ratelimit:",
      window,
    });
  }

  return new MemoryRateLimiter({ maxRequests, window });
}

export const ratelimitMiddleware = <
  TInContext extends Context,
  TInput = unknown,
>(
  limiter: RateLimiter,
  key: (
    options: MiddlewareOptions<TInContext, unknown, Record<never, never>>,
    input: TInput
  ) => string
) =>
  ratelimit<TInContext, TInput>({
    key,
    limiter,
  });
