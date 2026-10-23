import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { SecondaryStorage } from "better-auth";

const incrementWithTtl = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return value
`;

export const sharedStorage = (options: { url: string; token: string }) => {
  const redis = new Redis({ ...options, automaticDeserialization: false });

  const secondaryStorage: SecondaryStorage = {
    delete: async (key) => {
      await redis.del(key);
    },
    get: async (key) => await redis.get<string>(key),
    getAndDelete: async (key) => await redis.getdel<string>(key),
    increment: async (key, ttl) => {
      if (!Number.isInteger(ttl) || ttl <= 0) {
        throw new Error("Invalid increment TTL");
      }

      return Number(await redis.eval(incrementWithTtl, [key], [ttl]));
    },
    set: async (key, value, ttl) => {
      await redis.set(
        key,
        value,
        ttl === undefined || ttl === 0 ? {} : { ex: ttl }
      );
    },
  };

  // Match the platform's existing organization-wide limiter, including its Redis prefix.
  const limiter = new Ratelimit({
    limiter: Ratelimit.slidingWindow(100, "1000 ms"),
    prefix: "patchsmith:ratelimit:",
    redis,
  });

  return {
    limit: async (organizationId: string) => {
      const result = await limiter.limit(organizationId);
      await result.pending;

      return result.success;
    },
    secondaryStorage,
  };
};
