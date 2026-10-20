import { withSpan } from "@patchsmith/observability";
import { Redis } from "@upstash/redis";

import { env } from "#env";

import type { GetOptions, KV, SetOptions } from "./types.js";
import { withTimeout } from "./with-timeout.js";

const INCREMENT_WITH_TTL_SCRIPT = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;
export const createUpstashKV = (): KV<"upstash"> => {
  const token = env.KV_REST_API_TOKEN;
  const url = env.KV_REST_API_URL;
  if (
    !(token !== undefined && token !== null && token !== "") ||
    !(url !== undefined && url !== null && url !== "")
  ) {
    throw new Error(
      "KV_REST_API_TOKEN and KV_REST_API_URL are required for Upstash"
    );
  }
  const redis = new Redis({
    // The KV interface stores and returns raw strings; individual consumers parse JSON as needed.
    automaticDeserialization: false,

    token,

    url,
  });

  return {
    delete: async (key) => {
      await withSpan(
        "kv.delete",
        { attributes: { "kv.type": "upstash", "patchsmith.package": "kv" } },
        async () => await redis.del(key)
      );
    },
    engine: redis,
    get: async (key, options?: GetOptions) =>
      await withSpan(
        "kv.get",
        { attributes: { "kv.type": "upstash", "patchsmith.package": "kv" } },
        async () =>
          await withTimeout(
            (async () => {
              const value = await redis.get<string>(key);
              return value ?? null;
            })(),
            options?.timeout
          )
      ),
    getAndDelete: async (key) =>
      await withSpan(
        "kv.get_and_delete",
        { attributes: { "kv.type": "upstash", "patchsmith.package": "kv" } },
        async () => {
          const value = await redis.getdel<string>(key);
          return value ?? null;
        }
      ),
    increment: async (key, ttl) =>
      await withSpan(
        "kv.increment",
        {
          attributes: {
            "kv.ttl_seconds": ttl,
            "kv.type": "upstash",
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
            await redis.eval(INCREMENT_WITH_TTL_SCRIPT, [key], [ttl])
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
              "kv.type": "upstash",
              "patchsmith.package": "kv",
            },
          },
          async () => await redis.set(key, value, { ex: ttl })
        );
      } else {
        await withSpan(
          "kv.set",
          { attributes: { "kv.type": "upstash", "patchsmith.package": "kv" } },
          async () => await redis.set(key, value)
        );
      }
    },
    type: "upstash",
  };
};
