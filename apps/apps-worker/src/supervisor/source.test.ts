import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { appDeploymentMetadata } from "@tailorkit/api-utils/app-auth";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { deploymentSource } from "./source";

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
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

const setup = (contents: string | Uint8Array<ArrayBuffer> | null = code) => {
  // oxlint-disable-next-line eslint/require-await -- This synchronous fixture retains Promise results and rejected exceptions for the asynchronous adapter.
  const get = vi.fn(async () =>
    contents === null
      ? null
      : { body: requireValue(new Response(contents).body) }
  );

  return {
    get,
    source: deploymentSource({
      BUNDLES: { get },
      // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

      DEPLOYMENTS: {
        get: vi.fn<() => Promise<null>>().mockResolvedValue(null),
        put: vi.fn<() => Promise<void>>().mockReturnValue(Promise.resolve()),
      },

      PLATFORM_URL: "https://platform.test/api/platform",
      RUNTIME_SERVICE_TOKEN: "private",
    }),
  };
};

afterEach(() => vi.restoreAllMocks());

it("resolves authorized metadata separately from R2 code and never follows redirects with credentials", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json(deployment));
  const { source, get } = setup();

  expect(await Effect.runPromise(source.current(identity))).toEqual(deployment);
  expect(get).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      authorization: "Bearer private",
      "x-tailorkit-project-id": "project",
    },
    redirect: "manual",
  });

  expect(await Effect.runPromise(source.code(deployment))).toBe(code);
  expect(get).toHaveBeenCalledWith(deployment.objectKey);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([null, "tampered", `${code} extra`])(
  "rejects missing, corrupted and oversized R2 code: %s",
  async (contents) => {
    const awaitedResult1 = await Effect.runPromiseExit(
      setup(contents).source.code(deployment)
    );
    expect(awaitedResult1._tag).toBe("Failure");
  }
);

it.each([302, 403, 404, 503])(
  "fails closed when platform metadata returns %s",
  async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status })
    );
    const { source, get } = setup();

    const awaitedResult2 = await Effect.runPromiseExit(
      source.current(identity)
    );
    expect(awaitedResult2._tag).toBe("Failure");
    expect(get).not.toHaveBeenCalled();
  }
);

it("serves KV hits to old clients and fills misses from the platform", async () => {
  const values = new Map<
    string,
    ReturnType<typeof appDeploymentMetadata.parse>
  >();
  // oxlint-disable-next-line eslint/require-await -- This synchronous fixture retains Promise results and rejected exceptions for the asynchronous adapter.
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, appDeploymentMetadata.parse(JSON.parse(value)));
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ ...deployment, deploymentId: "v2" }))
    .mockResolvedValueOnce(
      Response.json({ ...deployment, deploymentId: "v2" })
    );
  const source = deploymentSource({
    BUNDLES: { get: vi.fn() },
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    DEPLOYMENTS: {
      // oxlint-disable-next-line eslint/require-await -- This synchronous fixture retains Promise results and rejected exceptions for the asynchronous adapter.
      get: async (key: string) => values.get(key) ?? null,
      put,
    },

    PLATFORM_URL: "https://platform.test",
    RUNTIME_SERVICE_TOKEN: "private",
  });
  const awaitedResult3 = await Effect.runPromise(source.current(identity));
  expect(awaitedResult3.deploymentId).toBe("v2");
  expect(put).toHaveBeenCalledOnce();
  const awaitedResult4 = await Effect.runPromise(
    source.current(identity, "v2")
  );
  expect(awaitedResult4.deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledOnce();
  values.set(JSON.stringify([identity.projectId, identity.appId]), deployment);
  // A stale replica must not cause a downgrade after v2 migrations ran.
  const awaitedResult5 = await Effect.runPromise(
    source.current(identity, "v2")
  );
  expect(awaitedResult5.deploymentId).toBe("v2");
  expect(fetch).toHaveBeenCalledTimes(2);
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

it.each([Buffer.from("not gzip"), gzipSync("x".repeat(3 * 1024 * 1024 + 1))])(
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
  "loads %s server code exactly at the 3 MiB limit",
  async (encoding) => {
    const content = "x".repeat(3 * 1024 * 1024);
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
    expect(await Effect.runPromise(setup(bytes).source.code(metadata))).toBe(
      content
    );
  }
);
