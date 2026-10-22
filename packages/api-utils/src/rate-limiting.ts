import { ratelimit } from "@orpc/ratelimit";
import type { RateLimiter } from "@orpc/ratelimit";
import { BaseRedisRateLimiter } from "@orpc/ratelimit/base-redis";
import { MemoryRateLimiter } from "@orpc/ratelimit/memory";
import { UpstashRateLimiter } from "@orpc/ratelimit/upstash";
import type { Context, MiddlewareOptions } from "@orpc/server";
import { getKV } from "@patchsmith/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

import { env } from "#env";

export { RateLimitHandlerPlugin } from "@orpc/ratelimit";

export const createRateLimiter = ({
  maxRequests,
  window,
}: {
  maxRequests: number;
  window: number;
}): RateLimiter => {
  const kv = getKV();

  if (kv?.type === "upstash") {
    const upstashRatelimit = new Ratelimit({
      limiter: Ratelimit.slidingWindow(maxRequests, `${window} ms`),
      prefix: "patchsmith:ratelimit:",
      redis: kv.engine,
    });

    return new UpstashRateLimiter(upstashRatelimit, {
      waitUntil: env.VERCEL === true ? vercelWaitUntil : undefined,
    });
  }

  if (kv?.type === "redis") {
    const redis = kv.engine;

    // Keep the shared ioredis connection through oRPC's Redis adapter base.
    class IORedisRateLimiter extends BaseRedisRateLimiter {
      private readonly redis = redis;
      protected async evalScript(
        script: string,
        keys: string[],
        args: string[]
      ): ReturnType<typeof redis.eval> {
        return await this.redis.eval(script, keys.length, ...keys, ...args);
      }
    }

    return new IORedisRateLimiter({
      maxRequests,
      prefix: "patchsmith:ratelimit:",
      window,
    });
  }

  return new MemoryRateLimiter({ maxRequests, window });
};

export const ratelimitMiddleware = <
  TInContext extends Context,
  TInput = unknown,
>(
  limiter: RateLimiter,
  key: (
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
    options: MiddlewareOptions<TInContext, unknown, Record<never, never>>,
    input: TInput
  ) => string
) =>
  ratelimit<TInContext, TInput>({
    key,
    limiter,
  });
