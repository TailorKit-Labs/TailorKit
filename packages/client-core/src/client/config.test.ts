import { asyncFixture } from "@tailorkit/config/testing";
import { expect, it, vi } from "vite-plus/test";

import { testContract } from "#test-contract";

import { createComponentRegistry, createTailorKitClientConfig } from "./config";

const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "app",
  projectId: "project",
  scope: { name: "workspace", value: { id: "workspace" } },
  subjectId: "principal",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

it("wraps each renderer once and shares it with remote component aliases", () => {
  const renderer = { id: "renderer" };
  const wrap = vi.fn((value: typeof renderer) => ({ wrapped: value }));
  const renderers = { CustomerCard: renderer, Missing: undefined };
  Object.setPrototypeOf(renderers, { Inherited: renderer });
  const registry = createComponentRegistry(renderers, wrap);
  expect(wrap).toHaveBeenCalledOnce();
  expect(registry.CustomerCard).toBe(registry["tailorkit-customer-card"]);
  expect(registry).not.toHaveProperty("Missing");
  expect(registry).not.toHaveProperty("Inherited");
});

it("builds reusable client configuration without initiating network requests", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const config = createTailorKitClientConfig({
    baseUrl: "https://host.test/api/",
    contract: testContract(),
    fetch,
  });
  expect(config.theme).toEqual({});
  expect(config.components).toEqual({});
  expect(config.fetchClient?.baseUrl.href).toBe("https://host.test/api/");
  expect(fetch).not.toHaveBeenCalled();
});

it("clears shared app data and sessions through clearCache", async () => {
  let user = "first";
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    asyncFixture((input) =>
      Response.json(
        (input instanceof Request ? input.url : String(input)).endsWith("/apps")
          ? [{ id: user }]
          : {
              expiresAt: Date.now() + 300_000,
              identity,
              token: user,
              url: "https://runtime.test/rpc",
            }
      )
    )
  );
  const config = createTailorKitClientConfig({
    baseUrl: "https://host.test/api/",
    contract: testContract(),
    fetch,
  });
  const client = require(config.fetchClient);
  const apps = client.apps();
  const session = client.endpoints.getSessionProvider({ id: "app" });
  await apps.fetch();
  await expect(session({ refresh: false })).resolves.toMatchObject({
    token: "first",
  });

  user = "second";
  config.clearCache();
  expect(apps.getSnapshot().data).toBeUndefined();
  await apps.fetch();
  expect(apps.getSnapshot().data).toEqual([{ id: "second" }]);
  await expect(session({ refresh: false })).resolves.toMatchObject({
    token: "second",
  });
  expect(fetch).toHaveBeenCalledTimes(4);
});
