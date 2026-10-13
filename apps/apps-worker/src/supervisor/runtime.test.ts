import { Effect } from "effect";
import { expect, it, vi, afterEach } from "vite-plus/test";

import { deploymentSource, installationName } from "./source";

afterEach(() => vi.restoreAllMocks());

const identity = {
  appId: "app",
  deploymentId: "v1",
  expiresAt: Date.now() + 120_000,
  installationId: "installation",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

const deployment = {
  appId: "app",
  checksum: "a".repeat(64),
  contentLength: 1,
  deploymentId: "v1",
  objectKey: "private/server.js",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

it.each([
  ["projectId", "other", "FORBIDDEN"],
  ["appId", "other", "FORBIDDEN"],
] as const)(
  "rejects mismatched %s before downloading code",
  async (field, value, code) => {
    const load = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ...deployment, [field]: value })
    );
    const source = deploymentSource({
      BUNDLES: { get: load },
      DEPLOYMENTS: {
        // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
      } as unknown as KVNamespace,
      PLATFORM_URL: "https://platform.test",
      RUNTIME_SERVICE_TOKEN: "private",
    });
    const result = await Effect.runPromise(
      source
        .current(identity)
        .pipe(Effect.catch((error) => Effect.succeed(error.code)))
    );
    expect(result).toBe(code);
    expect(load).not.toHaveBeenCalled();
  }
);

it("rejects a token that expires while resolving deployment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(deployment));
  const source = deploymentSource({
    BUNDLES: { get: vi.fn() },
    DEPLOYMENTS: {
      // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace,
    PLATFORM_URL: "https://platform.test",
    RUNTIME_SERVICE_TOKEN: "private",
  });
  const result = await Effect.runPromise(
    source
      .current({ ...identity, expiresAt: 0 })
      .pipe(Effect.catch((error) => Effect.succeed(error.code)))
  );
  expect(result).toBe("UNAUTHORIZED");
});

it("routes code versions to the same storage but separates hosts, projects, apps and installations", () => {
  const name = installationName(identity, "host");

  expect(installationName({ ...identity, deploymentId: "v2" }, "host")).toBe(
    name
  );

  for (const key of ["projectId", "appId", "installationId"] as const) {
    expect(installationName({ ...identity, [key]: "other" }, "host")).not.toBe(
      name
    );
  }

  expect(installationName(identity, "other")).not.toBe(name);
});
