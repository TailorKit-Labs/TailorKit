/* oxlint-disable max-classes-per-file -- Redis and Upstash doubles exercise distinct clients through the same adapter contract. */

import type { Redis as UpstashRedis } from "@upstash/redis";
/* oxlint-disable max-classes-per-file, no-useless-constructor, class-methods-use-this, require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member, import/first -- adapter mocks implement the Redis clients' asynchronous shape. */
import { describe, expect, it, vi } from "vite-plus/test";

interface RecordValue {
  value: string;
  until: number | null;
}
const state = vi.hoisted(() => ({
  redis: {
    clock: 0,
    data: new Map<string, RecordValue>(),
  },
  upstash: {
    clock: 0,
    data: new Map<string, RecordValue>(),
  },
}));

const read = (
  store: Pick<typeof state.redis, "clock" | "data">,
  key: string
): string | null => {
  const record = store.data.get(key);
  if (!record || (record.until !== null && record.until <= store.clock)) {
    return null;
  }
  return record.value;
};

vi.mock("#env", () => ({
  env: { KV_REST_API_TOKEN: "token", KV_REST_API_URL: "https://kv.test" },
}));
vi.mock("ioredis", () => ({
  default: class FakeRedis {
    constructor(_url: string) {}
    async get(key: string) {
      return read(state.redis, key);
    }
    async getdel(key: string) {
      const value = read(state.redis, key);
      state.redis.data.delete(key);
      return value;
    }
    async set(key: string, value: string) {
      state.redis.data.set(key, { until: null, value });
      return "OK";
    }
    async setex(key: string, ttl: number, value: string) {
      state.redis.data.set(key, {
        until: state.redis.clock + ttl * 1000,
        value,
      });
      return "OK";
    }
    async del(key: string) {
      state.redis.data.delete(key);
      return 1;
    }
    async eval(_script: string, _count: number, ...args: (string | number)[]) {
      const key = String(args[0]);
      const value = Number(read(state.redis, key) ?? "0") + 1;
      state.redis.data.set(key, {
        until: state.redis.clock + Number(args[1]) * 1000,
        value: String(value),
      });
      return value;
    }
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: class FakeUpstash {
    constructor(_options: ConstructorParameters<typeof UpstashRedis>[0]) {}
    async get(key: string) {
      return read(state.upstash, key);
    }
    async getdel(key: string) {
      const value = read(state.upstash, key);
      state.upstash.data.delete(key);
      return value;
    }
    async set(key: string, value: string, options?: { ex?: number }) {
      state.upstash.data.set(key, {
        until:
          options?.ex !== undefined &&
          options?.ex !== null &&
          options?.ex !== 0 &&
          !Number.isNaN(options?.ex)
            ? state.upstash.clock + options.ex * 1000
            : null,
        value,
      });
      return "OK";
    }
    async del(key: string) {
      state.upstash.data.delete(key);
      return 1;
    }
    async eval(_script: string, keys: string[], args: (number | string)[]) {
      const value = Number(read(state.upstash, keys[0]!) ?? "0") + 1;
      state.upstash.data.set(keys[0]!, {
        until: state.upstash.clock + Number(args[0]) * 1000,
        value: String(value),
      });
      return value;
    }
  },
}));

import { createRedisKV } from "./redis";
import { createUpstashKV } from "./upstash";

describe.each([
  ["redis", () => createRedisKV("redis://test"), state.redis],
  ["upstash", () => createUpstashKV(), state.upstash],
] as const)("%s KV contract", (_name, create, store) => {
  it("round-trips strings, replaces values, and expires values", async () => {
    store.data.clear();
    store.clock = 0;
    const writer = create();
    const reader = create();
    await writer.set("string", 'quoted "value"');
    expect(await reader.get("string")).toBe('quoted "value"');
    await writer.set("pointer", "build-1");
    await writer.set("pointer", "build-2");
    expect(await reader.get("pointer")).toBe("build-2");
    await writer.set("expiring", "value", { ttl: 1 });
    store.clock += 1001;
    expect(await reader.get("expiring")).toBeNull();
  });
});
