import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { maxDeploymentBytes } from "@patchsmith/asset-delivery";
import { asyncFixture } from "@patchsmith/config/testing";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { deploymentSource, metadataRevalidateMs } from "./source";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

const code = "export class AppFacet {}";

const deployment = {
  appId: "app",
  checksum: [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(""),
  contentLength: code.length,
  deploymentId: "v1",
  objectKey: "private/server/server.js",
  projectId: "project",
};

const identity = {
  ...deployment,
  expiresAt: Date.now() + 120_000,
  installationId: "one",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

const memory = () => {
  const values = new Map<string, string>();

  return {
    kv: {
      delete: (key: string) => values.delete(key),
      get: (key: string) => values.get(key),
      put: (key: string, value: string) => {
        values.set(key, value);
      },
    },
    transactionSync: (write: () => void) => {
      const snapshot = new Map(values);

      try {
        write();
      } catch (error) {
        values.clear();

        for (const [key, value] of snapshot) {
          values.set(key, value);
        }

        throw error;
      }
    },
  };
};

const setup = (
  contents: string | Uint8Array<ArrayBuffer> | null = code,
  storage = memory()
) => {
  const get = vi.fn(
    asyncFixture(() =>
      contents === null
        ? null
        : { body: requireValue(new Response(contents).body) }
    )
  );

  const tasks: Promise<void>[] = [];

  const source = deploymentSource(
    {
      BUNDLES: { get },
      PLATFORM_URL: "https://platform.test/api/platform",
      RUNTIME_SERVICE_TOKEN: "private",
    },
    storage,
    (task) => {
      tasks.push(task);
    }
  );

  return { get, source, storage, tasks };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("persists metadata across supervisor recreation without a network lookup", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(asyncFixture(() => Response.json(deployment)));

  const first = setup();
  expect(await Effect.runPromise(first.source.current(identity))).toEqual(
    deployment
  );
  const restarted = setup(code, first.storage);
  expect(await Effect.runPromise(restarted.source.current(identity))).toEqual(
    deployment
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      authorization: "Bearer private",
      "x-patchsmith-project-id": "project",
    },
    redirect: "manual",
  });
});

it("serves stale metadata immediately and deduplicates hourly background revalidation", async () => {
  vi.useFakeTimers();
  const release = Promise.withResolvers<Response>();

  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(deployment))
    .mockImplementationOnce(async () => await release.promise);

  const first = setup();
  await Effect.runPromise(first.source.current(identity));
  vi.setSystemTime(Date.now() + metadataRevalidateMs);
  const caller = { ...identity, expiresAt: Date.now() + 120_000 };
  expect(await Effect.runPromise(first.source.current(caller))).toEqual(
    deployment
  );
  expect(await Effect.runPromise(first.source.current(caller))).toEqual(
    deployment
  );
  expect(first.tasks).toHaveLength(1);
  release.resolve(Response.json({ ...deployment, deploymentId: "v2" }));
  await Promise.all(first.tasks);
  const resolved1 = await Effect.runPromise(first.source.current(caller));

  expect(resolved1.deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("confirms a new token hint immediately while old clients keep the latest deployment", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(deployment))
    .mockImplementation(
      asyncFixture(() => Response.json({ ...deployment, deploymentId: "v2" }))
    );

  const { source } = setup();
  await Effect.runPromise(source.current(identity));

  const resolved2 = await Effect.runPromise(
    source.current({ ...identity, deploymentId: "v2" })
  );

  expect(resolved2.deploymentId).toBe("v2");
  const resolved3 = await Effect.runPromise(source.current(identity));

  expect(resolved3.deploymentId).toBe("v2");
  const resolved4 = await Effect.runPromise(source.current(identity));

  expect(resolved4.deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("orders a delayed revalidation before a newer publication confirmation", async () => {
  const release = Promise.withResolvers<Response>();

  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(async () => await release.promise)
    .mockResolvedValueOnce(
      Response.json({ ...deployment, deploymentId: "v2" })
    );

  const { source, storage } = setup();
  const older = source.refresh(identity);
  const newer = source.refresh({ ...identity, deploymentId: "v2" });
  release.resolve(Response.json(deployment));
  await Promise.all([older, newer]);
  const restarted = setup(code, storage);

  const resolved5 = await Effect.runPromise(
    restarted.source.current({ ...identity, deploymentId: "v2" })
  );

  expect(resolved5.deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retains stale metadata when background revalidation fails", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(deployment))
    .mockRejectedValue(new Error("Unavailable"));
  const fixture = setup();
  await Effect.runPromise(fixture.source.current(identity));
  vi.setSystemTime(Date.now() + metadataRevalidateMs);
  const caller = { ...identity, expiresAt: Date.now() + 120_000 };
  expect(await Effect.runPromise(fixture.source.current(caller))).toEqual(
    deployment
  );
  await Promise.all(fixture.tasks);
  expect(fixture.storage.kv.get("runtime:metadata")).toContain(
    '"deploymentId":"v1"'
  );
});

it("restores verified decoded code from storage after eviction without R2", async () => {
  const content = `//${"x".repeat(160_000)}`;

  const metadata = {
    ...deployment,
    checksum: createHash("sha256").update(content).digest("hex"),
    contentLength: content.length,
  };

  const first = setup(content);
  expect(await Effect.runPromise(first.source.code(metadata))).toBe(content);
  const restarted = setup(null, first.storage);
  expect(await Effect.runPromise(restarted.source.code(metadata))).toBe(
    content
  );
  expect(first.get).toHaveBeenCalledOnce();
  expect(restarted.get).not.toHaveBeenCalled();
  const smaller = { ...deployment, deploymentId: "v2" };
  expect(
    await Effect.runPromise(setup(code, first.storage).source.code(smaller))
  ).toBe(code);
  expect(first.storage.kv.get("runtime:bundle:1")).toBeUndefined();
});

it("verifies compressed server bytes before inflating and caches the decoded code", async () => {
  const bytes = gzipSync(code);

  const metadata = {
    ...deployment,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    contentEncoding: "gzip" as const,
    contentLength: bytes.byteLength,
  };

  const { source, get } = setup(bytes);
  expect(await Effect.runPromise(source.code(metadata))).toBe(code);
  expect(await Effect.runPromise(source.code(metadata))).toBe(code);
  expect(get).toHaveBeenCalledOnce();
  const tampered = { ...metadata, checksum: "a".repeat(64) };

  const awaitedResult6 = await Effect.runPromiseExit(
    setup(bytes).source.code(tampered)
  );

  expect(awaitedResult6._tag).toBe("Failure");

  const awaitedResult7 = await Effect.runPromiseExit(
    setup(bytes).source.code({
      ...metadata,
      contentLength: bytes.byteLength + 1,
    })
  );

  expect(awaitedResult7._tag).toBe("Failure");
});

it.each([
  Buffer.from("not gzip"),
  gzipSync("x".repeat(maxDeploymentBytes + 1)),
])(
  "rejects invalid gzip and inflated code exceeding the deployment limit",
  async (bytes) => {
    const metadata = {
      ...deployment,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      contentEncoding: "gzip" as const,
      contentLength: bytes.byteLength,
    };

    const awaitedResult8 = await Effect.runPromiseExit(
      setup(bytes).source.code(metadata)
    );

    expect(awaitedResult8._tag).toBe("Failure");
  }
);

it.each(["utf-8", "gzip"] as const)(
  "loads %s server code exactly at the 10 MiB limit",
  async (encoding) => {
    const content = "x".repeat(maxDeploymentBytes);

    const bytes =
      encoding === "gzip" ? gzipSync(content) : Buffer.from(content);

    const metadata =
      encoding === "gzip"
        ? {
            ...deployment,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            contentEncoding: "gzip" as const,
            contentLength: bytes.byteLength,
          }
        : {
            ...deployment,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            contentLength: bytes.byteLength,
          };

    const first = setup(bytes);
    expect(await Effect.runPromise(first.source.code(metadata))).toBe(content);
    const restarted = setup(null, first.storage);
    expect(await Effect.runPromise(restarted.source.code(metadata))).toBe(
      content
    );
    expect(restarted.get).not.toHaveBeenCalled();
  }
);

it("keeps the previous decoded bundle intact if a replacement storage write fails", async () => {
  const first = setup();
  await Effect.runPromise(first.source.code(deployment));
  const content = `//${"x".repeat(100_000)}`;

  const next = {
    ...deployment,
    checksum: createHash("sha256").update(content).digest("hex"),
    contentLength: content.length,
    deploymentId: "v2",
  };

  const write = first.storage.kv.put;

  const put = vi
    .spyOn(first.storage.kv, "put")
    .mockImplementation((key, value) => {
      if (key === "runtime:bundle:1") {
        throw new Error("Storage failure");
      }

      write(key, value);
    });

  const result = await Effect.runPromiseExit(
    setup(content, first.storage).source.code(next)
  );

  expect(result._tag).toBe("Failure");
  put.mockRestore();
  const restarted = setup(null, first.storage);
  expect(await Effect.runPromise(restarted.source.code(deployment))).toBe(code);
  expect(restarted.get).not.toHaveBeenCalled();
});

it("rejects authentication that expires during an authoritative metadata lookup", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    asyncFixture(() => {
      vi.setSystemTime(Date.now() + 180_000);

      return Response.json(deployment);
    })
  );
  const { source } = setup();

  const result = await Effect.runPromiseExit(
    source.current({ ...identity, expiresAt: Date.now() + 120_000 })
  );

  expect(result._tag).toBe("Failure");
});
