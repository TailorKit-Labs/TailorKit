import { withSpan } from "@patchsmith/observability";
import IORedis from "ioredis";

import type { GetOptions, KV, SetOptions } from "./types.js";
import { withTimeout } from "./with-timeout.js";

const INCREMENT_WITH_TTL_SCRIPT = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;
export const createRedisKV = (url: string): KV<"redis"> => {
  const redis = new IORedis(url);

  return {
    delete: async (key) => {
      await withSpan(
        "kv.delete",
        { attributes: { "kv.type": "redis", "patchsmith.package": "kv" } },
        async () => await redis.del(key)
      );
    },
    engine: redis,
    get: async (key, options?: GetOptions) =>
      await withSpan(
        "kv.get",
        { attributes: { "kv.type": "redis", "patchsmith.package": "kv" } },
        async () => await withTimeout(redis.get(key), options?.timeout)
      ),
    getAndDelete: async (key) =>
      await withSpan(
        "kv.get_and_delete",
        { attributes: { "kv.type": "redis", "patchsmith.package": "kv" } },
        async () => await redis.getdel(key)
      ),
    increment: async (key, ttl) =>
      await withSpan(
        "kv.increment",
        {
          attributes: {
            "kv.ttl_seconds": ttl,
            "kv.type": "redis",
            "patchsmith.package": "kv",
          },
        },
        async () => {
          if (!Number.isInteger(ttl) || ttl <= 0) {
            throw new TypeError(
              "Redis increment TTL must be a positive integer"
            );
          }

          return Number(
            await redis.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, ttl)
          );
        }
      ),
    set: async (key, value, options?: SetOptions) => {
      if (
        options?.ttl !== undefined &&
        options?.ttl !== null &&
        options?.ttl !== 0 &&
        !Number.isNaN(options?.ttl)
      ) {
        const { ttl } = options;
        await withSpan(
          "kv.set",
          {
            attributes: {
              "kv.ttl_seconds": ttl,
              "kv.type": "redis",
              "patchsmith.package": "kv",
            },
          },
          async () => await redis.setex(key, ttl, value)
        );
      } else {
        await withSpan(
          "kv.set",
          { attributes: { "kv.type": "redis", "patchsmith.package": "kv" } },
          async () => await redis.set(key, value)
        );
      }
    },
    type: "redis",
  };
};
