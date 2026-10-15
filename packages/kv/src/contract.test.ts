/* oxlint-disable max-classes-per-file -- Redis and Upstash doubles exercise distinct clients through the same adapter contract. */
import { createHash } from "node:crypto";

import type { Redis as UpstashRedis } from "@upstash/redis";
/* oxlint-disable max-classes-per-file, no-useless-constructor, class-methods-use-this, require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member, import/first -- adapter mocks implement the Redis clients' asynchronous shape. */
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

// oxlint-disable-next-line import/no-relative-parent-imports -- Adapter integration tests reuse built platform types without adding a cyclic workspace dependency.
import type * as PreviewBuildModule from "../../api-platform/dist/preview-build-store.mjs";

interface RecordValue {
  value: string;
  until: number | null;
}
interface RedisSubscriber {
  channels: Set<string>;
  handlers: Map<string, (...args: string[]) => void>;
}
interface UpstashSubscriber {
  channel: string;
  handlers: Map<string, (message?: { message: string }) => void>;
}
const pointerRevision = (source: string): number => {
  const result = z
    .object({ revision: z.number() })
    .safeParse(JSON.parse(source));
  if (!result.success) {
    throw new Error("Invalid revision pointer fixture");
  }
  return result.data.revision;
};
const state = vi.hoisted(() => ({
  redis: {
    clock: 0,
    data: new Map<string, RecordValue>(),
    subscribers: new Set<RedisSubscriber>(),
  },
  upstash: {
    clock: 0,
    data: new Map<string, RecordValue>(),
    subscribers: new Set<UpstashSubscriber>(),
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
    channels = new Set<string>();
    handlers = new Map<string, (...args: string[]) => void>();
    constructor(_url: string) {}
    duplicate() {
      return new FakeRedis("");
    }
    on(name: string, handler: (...args: string[]) => void) {
      this.handlers.set(name, handler);
    }
    removeAllListeners(name?: string) {
      if (name !== undefined && name !== null && name !== "") {
        this.handlers.delete(name);
      } else {
        this.handlers.clear();
      }
    }
    async subscribe(channel: string) {
      this.channels.add(channel);
      state.redis.subscribers.add(this);
      return 1;
    }
    async unsubscribe(channel: string) {
      this.channels.delete(channel);
      state.redis.subscribers.delete(this);
      return 1;
    }
    disconnect() {
      state.redis.subscribers.delete(this);
    }
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
    async eval(script: string, _count: number, ...args: (string | number)[]) {
      const key = String(args[0]);
      if (script.includes('redis.call("SET", KEYS[2], "1", "EX"')) {
        if (read(state.redis, String(args[2])) !== null) {
          return 0;
        }
        state.redis.data.set(key, {
          until: state.redis.clock + Number(args[4]) * 1000,
          value: String(args[3]),
        });
        state.redis.data.set(String(args[1]), {
          until: state.redis.clock + Number(args[5]) * 1000,
          value: "1",
        });
        return 1;
      }
      if (script.includes('redis.call("SET", KEYS[3], "1", "EX"')) {
        if (read(state.redis, String(args[2])) !== null) {
          return 0;
        }
        if (
          read(state.redis, key) !== null ||
          (read(state.redis, String(args[1])) === null && args[4] !== "1")
        ) {
          return 1;
        }
        state.redis.data.set(String(args[2]), {
          until: state.redis.clock + Number(args[3]) * 1000,
          value: "1",
        });
        return 0;
      }
      if (script.includes('ARGV[2], "EX", ARGV[3]')) {
        if (
          read(state.redis, String(args[1])) !== null ||
          (read(state.redis, key) ?? "") !== args[2]
        ) {
          return 0;
        }
        state.redis.data.set(key, {
          until: state.redis.clock + Number(args[4]) * 1000,
          value: String(args[3]),
        });
        return 1;
      }
      if (script.includes("cjson.decode")) {
        const ownerKey = String(args[1]);
        if (
          read(state.redis, String(args[2])) !== null ||
          read(state.redis, ownerKey) !== args[3]
        ) {
          return 0;
        }
        const current = read(state.redis, key);
        if (
          current !== undefined &&
          current !== null &&
          current !== "" &&
          pointerRevision(current) >= Number(args[4])
        ) {
          return 0;
        }
        state.redis.data.set(key, {
          until: state.redis.clock + Number(args[6]) * 1000,
          value: String(args[5]),
        });
        state.redis.data.delete(ownerKey);
        return 1;
      }
      const value = Number(read(state.redis, key) ?? "0") + 1;
      state.redis.data.set(key, {
        until: state.redis.clock + Number(args[1]) * 1000,
        value: String(value),
      });
      return value;
    }
    async publish(channel: string, message: string) {
      let count = 0;
      for (const subscriber of state.redis.subscribers) {
        if (subscriber.channels.has(channel)) {
          subscriber.handlers.get("message")?.(channel, message);
          count += 1;
        }
      }
      return count;
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
    async eval(script: string, keys: string[], args: (number | string)[]) {
      if (script.includes('redis.call("SET", KEYS[2], "1", "EX"')) {
        if (read(state.upstash, keys[2]!) !== null) {
          return 0;
        }
        state.upstash.data.set(keys[0]!, {
          until: state.upstash.clock + Number(args[1]) * 1000,
          value: String(args[0]),
        });
        state.upstash.data.set(keys[1]!, {
          until: state.upstash.clock + Number(args[2]) * 1000,
          value: "1",
        });
        return 1;
      }
      if (script.includes('redis.call("SET", KEYS[3], "1", "EX"')) {
        if (read(state.upstash, keys[2]!) !== null) {
          return 0;
        }
        if (
          read(state.upstash, keys[0]!) !== null ||
          (read(state.upstash, keys[1]!) === null && args[1] !== "1")
        ) {
          return 1;
        }
        state.upstash.data.set(keys[2]!, {
          until: state.upstash.clock + Number(args[0]) * 1000,
          value: "1",
        });
        return 0;
      }
      if (script.includes('ARGV[2], "EX", ARGV[3]')) {
        if (
          read(state.upstash, keys[1]!) !== null ||
          (read(state.upstash, keys[0]!) ?? "") !== args[0]
        ) {
          return 0;
        }
        state.upstash.data.set(keys[0]!, {
          until: state.upstash.clock + Number(args[2]) * 1000,
          value: String(args[1]),
        });
        return 1;
      }
      if (script.includes("cjson.decode")) {
        if (
          read(state.upstash, keys[2]!) !== null ||
          read(state.upstash, keys[1]!) !== args[0]
        ) {
          return 0;
        }
        const current = read(state.upstash, keys[0]!);
        if (
          current !== undefined &&
          current !== null &&
          current !== "" &&
          pointerRevision(current) >= Number(args[1])
        ) {
          return 0;
        }
        state.upstash.data.set(keys[0]!, {
          until: state.upstash.clock + Number(args[3]) * 1000,
          value: String(args[2]),
        });
        state.upstash.data.delete(keys[1]!);
        return 1;
      }
      const value = Number(read(state.upstash, keys[0]!) ?? "0") + 1;
      state.upstash.data.set(keys[0]!, {
        until: state.upstash.clock + Number(args[0]) * 1000,
        value: String(value),
      });
      return value;
    }
    subscribe(channel: string) {
      const handlers = new Map<
        string,
        (message?: { message: string }) => void
      >();
      const subscriber = {
        channel,
        handlers,
        on(name: string, handler: (message?: { message: string }) => void) {
          handlers.set(name, handler);
        },
        removeAllListeners() {
          handlers.clear();
        },
        async unsubscribe() {
          state.upstash.subscribers.delete(subscriber);
        },
      };
      state.upstash.subscribers.add(subscriber);
      queueMicrotask(() => handlers.get("subscribe")?.());
      return subscriber;
    }
    async publish(channel: string, message: string) {
      let count = 0;
      for (const subscriber of state.upstash.subscribers) {
        if (subscriber.channel === channel) {
          subscriber.handlers.get("message")?.({ message });
          count += 1;
        }
      }
      return count;
    }
  },
}));

import { createRedisKV } from "./redis";
import { createUpstashKV } from "./upstash";

describe.each([
  ["redis", () => createRedisKV("redis://test"), state.redis],
  ["upstash", () => createUpstashKV(), state.upstash],
] as const)("%s KV contract", (_name, create, store) => {
  it("round-trips strings, replaces pointers, expires values, and cleans up subscriptions", async () => {
    store.data.clear();
    store.subscribers.clear();
    store.clock = 0;
    const writer = create();
    const reader = create();
    await writer.set("string", 'quoted "value"');
    expect(await reader.get("string")).toBe('quoted "value"');
    await writer.set("pointer", "build-1");
    await writer.set("pointer", "build-2");
    expect(await reader.get("pointer")).toBe("build-2");
    await writer.set("upload-owner", "build-2", { ttl: 1 });
    expect(
      await writer.promoteIfOwnerAndNewer(
        "revision-pointer",
        "upload-owner",
        "ended-marker",
        "build-2",
        JSON.stringify({ revision: 2 }),
        2,
        1
      )
    ).toBe(true);
    expect(await reader.get("upload-owner")).toBeNull();
    await writer.set("upload-owner", "build-1", { ttl: 1 });
    expect(
      await writer.promoteIfOwnerAndNewer(
        "revision-pointer",
        "upload-owner",
        "ended-marker",
        "build-1",
        JSON.stringify({ revision: 1 }),
        1,
        1
      )
    ).toBe(false);
    expect(await reader.get("upload-owner")).toBe("build-1");
    expect(await reader.get("revision-pointer")).toBe(
      JSON.stringify({ revision: 2 })
    );
    expect(
      await writer.promoteIfOwnerAndNewer(
        "revision-pointer",
        "upload-owner",
        "ended-marker",
        "cancelled",
        JSON.stringify({ revision: 3 }),
        3,
        1
      )
    ).toBe(false);
    await writer.set("upload-owner", "build-3", { ttl: 1 });
    expect(
      await writer.promoteIfOwnerAndNewer(
        "revision-pointer",
        "upload-owner",
        "ended-marker",
        "build-3",
        JSON.stringify({ revision: 3 }),
        3,
        1
      )
    ).toBe(true);
    expect(await reader.get("revision-pointer")).toBe(
      JSON.stringify({ revision: 3 })
    );
    await writer.set("upload-owner", "build-4", { ttl: 1 });
    await writer.set("ended-marker", "1", { ttl: 1 });
    expect(
      await writer.promoteIfOwnerAndNewer(
        "revision-pointer",
        "upload-owner",
        "ended-marker",
        "build-4",
        JSON.stringify({ revision: 4 }),
        4,
        1
      )
    ).toBe(false);
    expect(await reader.get("revision-pointer")).toBe(
      JSON.stringify({ revision: 3 })
    );
    await writer.set("expiring", "value", { ttl: 1 });
    store.clock += 1001;
    expect(await reader.get("expiring")).toBeNull();
    expect(await reader.get("revision-pointer")).toBeNull();
    const messages: string[] = [];
    const unsubscribe = await reader.subscribe("changes", (message) => {
      messages.push(message);
    });
    await writer.publish("changes", "revision-1");
    expect(messages).toEqual(["revision-1"]);
    await unsubscribe();
    await writer.publish("changes", "revision-2");
    expect(messages).toEqual(["revision-1"]);
    expect(store.subscribers.size).toBe(0);
  });
  it("delivers a committed preview across two platform instances", async () => {
    const moduleUrl = new URL(
      "../../api-platform/src/preview-build-store.ts",
      import.meta.url
    ).href;
    /** The built declaration describes the source module loaded for this adapter integration test.
     * @type {typeof PreviewBuildModule}
     */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- A fixed source URL selects this trusted workspace module; dynamic import cannot infer its declaration type.
    const previewModule: typeof PreviewBuildModule = await import(moduleUrl);
    const { createPreviewBuildStore } = previewModule;
    store.data.clear();
    store.subscribers.clear();
    store.clock = 0;
    const uploader = createPreviewBuildStore(create());
    const viewer = createPreviewBuildStore(create());
    const notifications: (number | null)[] = [];
    const unsubscribe = await viewer.subscribe(
      "session",

      (revision: number | null) => {
        notifications.push(revision);
      }
    );
    const bytes = Buffer.from("export default 1");
    const buildId = await uploader.begin("session", {
      files: [
        {
          chunks: 1,
          contentType: "text/javascript",
          path: "client.js",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        },
      ],
    });
    expect(await viewer.current("session")).toBeNull();
    await uploader.upload("session", buildId, 0, 0, bytes.toString("base64"));
    const committed = await uploader.commit("session", buildId);
    expect(notifications).toEqual([committed.revision]);
    expect((await viewer.current("session"))?.buildId).toBe(buildId);
    expect(await viewer.chunk("session", buildId, 0, 0)).toBe(
      bytes.toString("base64")
    );
    await uploader.end("session");
    expect(notifications).toEqual([committed.revision, null]);
    expect(await viewer.current("session")).toBeNull();
    await unsubscribe();
  });
  it("allows only one begin to claim an unchanged upload marker", async () => {
    const moduleUrl = new URL(
      "../../api-platform/src/preview-build-store.ts",
      import.meta.url
    ).href;
    /** The built declaration describes the source module loaded for this adapter integration test.
     * @type {typeof PreviewBuildModule}
     */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- A fixed source URL selects this trusted workspace module; dynamic import cannot infer its declaration type.
    const previewModule: typeof PreviewBuildModule = await import(moduleUrl);
    const { createPreviewBuildStore } = previewModule;
    store.data.clear();
    store.clock = 0;
    let reads = 0;
    let releaseReads: (() => void) | undefined;
    const bothRead = (async () => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers<ReturnType<() => void>>();
      try {
        releaseReads = resolve;
      } catch (error) {
        rejectPending(error);
      }
      await pendingPromise;
    })();
    const withConcurrentRead = () => {
      const kv = create();
      return {
        ...kv,
        get: async (key: string) => {
          const value = await kv.get(key);
          if (key === "preview:uploading:session" && (reads += 1) <= 2) {
            if (reads === 2) {
              releaseReads?.();
            }
            await bothRead;
          }
          return value;
        },
      };
    };
    const first = createPreviewBuildStore(withConcurrentRead());
    const second = createPreviewBuildStore(withConcurrentRead());
    const bytes = Buffer.from("export default 1");
    const manifest = {
      files: [
        {
          chunks: 1,
          contentType: "text/javascript",
          path: "client.js",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        },
      ],
    };
    const results = await Promise.allSettled([
      first.begin("session", manifest),
      second.begin("session", manifest),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      message: "Preview upload was cancelled or superseded.",
    });
    const buildId = accepted[0]?.value;
    if (buildId === undefined) {
      throw new Error("Expected one accepted upload.");
    }
    expect(await create().get("preview:uploading:session")).toBe(buildId);
    await first.upload("session", buildId, 0, 0, bytes.toString("base64"));
  });
  it("keeps a verified build retryable after the initial upload lease expires", async () => {
    const moduleUrl = new URL(
      "../../api-platform/src/preview-build-store.ts",
      import.meta.url
    ).href;
    /** The built declaration describes the source module loaded for this adapter integration test.
     * @type {typeof PreviewBuildModule}
     */
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- A fixed source URL selects this trusted workspace module; dynamic import cannot infer its declaration type.
    const previewModule: typeof PreviewBuildModule = await import(moduleUrl);
    const { createPreviewBuildStore } = previewModule;
    store.data.clear();
    store.clock = 0;
    const kv = create();
    let failPromotion = true;
    const uploader = createPreviewBuildStore({
      ...kv,
      promoteIfOwnerAndNewer: async (
        ...args: Parameters<typeof kv.promoteIfOwnerAndNewer>
      ) => {
        if (failPromotion) {
          failPromotion = false;
          throw new Error("Transient KV failure");
        }
        return await kv.promoteIfOwnerAndNewer(...args);
      },
    });
    const bytes = Buffer.from("export default 1");
    const buildId = await uploader.begin("session", {
      files: [
        {
          chunks: 1,
          contentType: "text/javascript",
          path: "client.js",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        },
      ],
    });
    await uploader.upload("session", buildId, 0, 0, bytes.toString("base64"));
    await expect(uploader.commit("session", buildId)).rejects.toThrow(
      "Transient KV failure"
    );
    store.clock += 15 * 60 * 1000 + 1;
    expect(await kv.get("preview:uploading:session")).toBe(buildId);
    const committed = await uploader.commit("session", buildId);
    expect(committed.buildId).toBe(buildId);
    expect((await uploader.current("session"))?.buildId).toBe(buildId);
  });
  it("fences grace expiry against a renewing heartbeat", async () => {
    store.data.clear();
    store.clock = 0;
    const checker = create();
    const heartbeat = create();
    const presenceKey = "preview:developer-connection:session";
    const seenKey = "preview:developer-seen:session";
    const endedKey = "preview:ended:session";

    expect(
      await checker.keepPreviewSessionIfDeveloperPresent(
        presenceKey,
        seenKey,
        endedKey,
        3600
      )
    ).toBe(true);
    expect(
      await heartbeat.setPreviewPresenceIfActive(
        presenceKey,
        seenKey,
        endedKey,
        "first",
        75,
        3600
      )
    ).toBe(true);
    store.clock += 75_001;
    expect(await checker.get(presenceKey)).toBeNull();

    // The heartbeat wins after the checker has observed the expired lease.
    expect(
      await heartbeat.setPreviewPresenceIfActive(
        presenceKey,
        seenKey,
        endedKey,
        "reconnected",
        75,
        3600
      )
    ).toBe(true);
    expect(
      await checker.keepPreviewSessionIfDeveloperPresent(
        presenceKey,
        seenKey,
        endedKey,
        3600
      )
    ).toBe(true);
    expect(await checker.get(endedKey)).toBeNull();

    store.clock += 75_001;
    expect(
      await checker.keepPreviewSessionIfDeveloperPresent(
        presenceKey,
        seenKey,
        endedKey,
        3600
      )
    ).toBe(false);
    expect(
      await heartbeat.setPreviewPresenceIfActive(
        presenceKey,
        seenKey,
        endedKey,
        "too-late",
        75,
        3600
      )
    ).toBe(false);
    expect(await checker.get(presenceKey)).toBeNull();
  });
  it("expires a never-connected session only when first-connection grace has elapsed", async () => {
    store.data.clear();
    store.clock = 0;
    const kv = create();
    const presenceKey = "preview:developer-connection:session";
    const seenKey = "preview:developer-seen:session";
    const endedKey = "preview:ended:session";
    expect(
      await kv.keepPreviewSessionIfDeveloperPresent(
        presenceKey,
        seenKey,
        endedKey,
        3600
      )
    ).toBe(true);
    expect(
      await kv.keepPreviewSessionIfDeveloperPresent(
        presenceKey,
        seenKey,
        endedKey,
        3600,
        true
      )
    ).toBe(false);
    expect(await kv.get(endedKey)).toBe("1");
  });
});
