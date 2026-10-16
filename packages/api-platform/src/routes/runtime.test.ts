import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { Context } from "#context";

import {
  getRuntimeBundle,
  handlePublicRuntimeRequest,
  publishRuntimeMetadata,
} from "./runtime";

const state = vi.hoisted(() => ({
  env: {
    APP_RUNTIME_INTERNAL_URL: "https://internal.tailorkit.app",
    APP_RUNTIME_SERVICE_TOKEN: "x".repeat(32),
  },
  findApp: vi.fn(),
  findFile: vi.fn(),
  publicKeys: vi.fn(() => ({
    keys: [{ crv: "P-256", kid: "platform", kty: "EC", x: "x", y: "y" }],
  })),
}));

vi.mock("../env", () => ({ env: state.env }));

vi.mock("@tailorkit/db", () => ({
  db: {
    query: {
      app: { findFirst: state.findApp },
      appDeploymentFile: { findFirst: state.findFile },
    },
  },
}));

vi.mock("@tailorkit/kv", () => ({ getKV: () => {} }));

vi.mock("../runtime/auth", () => ({
  appRuntimePublicKeys: state.publicKeys,
  issueAppRuntimeToken: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("serves public signing keys at the existing URL without an authenticated context", async () => {
  const response = handlePublicRuntimeRequest(
    new Request("https://platform.test/api/platform/runtime/keys")
  );
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("public, max-age=60");
  await expect(response?.json()).resolves.toEqual(state.publicKeys());
});

it.each([
  ["GET", "/api/platform/apps/app/runtime/session"],
  ["POST", "/api/platform/runtime/keys"],
])("leaves %s %s for authenticated route handling", (method, path) => {
  expect(
    handlePublicRuntimeRequest(
      new Request(`https://platform.test${path}`, { method })
    )
  ).toBeUndefined();
  expect(state.publicKeys).not.toHaveBeenCalled();
});

it("returns a non-cacheable error when signing keys are unavailable", () => {
  state.publicKeys.mockImplementationOnce(() => {
    throw new Error("Private configuration details");
  });
  const response = handlePublicRuntimeRequest(
    new Request("https://platform.test/api/platform/runtime/keys")
  );
  expect(response?.status).toBe(503);
  expect(response?.headers.get("cache-control")).toBe("no-store");
});

it("publishes deployment metadata to the worker with the service credential", async () => {
  const metadata = {
    appId: "app",
    checksum: "a".repeat(64),
    contentLength: 10,
    deploymentId: "v2",
    objectKey: "private/server.js",
    projectId: "project",
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  try {
    await publishRuntimeMetadata(metadata, "app000000001");
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        "https://internal.tailorkit.app/p/project/a/app000000001/new-deployment"
      ),
      expect.objectContaining({
        body: JSON.stringify(metadata),
        headers: {
          authorization: `Bearer ${state.env.APP_RUNTIME_SERVICE_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
      })
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(
      publishRuntimeMetadata(metadata, "app000000001")
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  } finally {
    fetch.mockRestore();
  }
});

it("returns deployment metadata directly as the HTTP response body", async () => {
  const metadata = {
    appId: "app",
    checksum: "a".repeat(64),
    contentLength: 123,
    deploymentId: "deployment",
    objectKey:
      "projects/proj00000001/apps/app-public/deployments/deployment-public/server/server.js",
    projectId: "project",
  };
  state.findApp.mockResolvedValueOnce({
    currentDeployment: {
      id: metadata.deploymentId,
      shortId: "deployment-public",
    },
    id: metadata.appId,
    shortId: "app-public",
  });
  state.findFile.mockResolvedValueOnce(metadata);
  const handler = new OpenAPIHandler({ runtime: getRuntimeBundle });
  // SAFETY: This test supplies the context members read by the handler; unrelated request context services are outside this scenario.
  const { matched, response } = await handler.handle(
    new Request("https://platform.test/api/platform/apps/app/runtime", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    {
      context:
        /* oxlint-disable typescript/no-unsafe-type-assertion -- This test supplies the context members read by the handler; unrelated request context services are outside this scenario. */
        {
          organization: { id: "organization", shortId: "team" },
          project: { id: metadata.projectId, shortId: "proj00000001" },
          runtimeService: true,
        } as Context,
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      prefix: "/api/platform",
    }
  );
  expect(matched).toBe(true);
  expect(response?.status).toBe(200);
  await expect(response?.json()).resolves.toEqual(metadata);
});
