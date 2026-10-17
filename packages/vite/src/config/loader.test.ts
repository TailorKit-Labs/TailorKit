import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as v from "valibot";
import { expect, it } from "vite-plus/test";

import { tailorkitConfigSchema } from "./config";
import { loadTailorKitConfig } from "./loader";

it.each(["", "   "])("rejects a blank app name: %j", (name) => {
  expect(() =>
    v.parse(tailorkitConfigSchema, { host: "https://host.test", name })
  ).toThrow();
});

it("loads and trims the configured app name and description", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-named-config-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", name: "  My App  ", description: "  My app description  " };'
    );
    const loaded = await loadTailorKitConfig(undefined, root);
    expect(loaded.config.name).toBe("My App");
    expect(loaded.config.description).toBe("My app description");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it.each([null, "", "a".repeat(255)])(
  "accepts a clear, empty, or maximum-length description: %j",
  (description) => {
    expect(
      v.parse(tailorkitConfigSchema, { description, host: "https://host.test" })
    ).toMatchObject({ description });
  }
);

it("rejects app descriptions longer than 255 characters", () => {
  expect(() =>
    v.parse(tailorkitConfigSchema, {
      description: "a".repeat(256),
      host: "https://host.test",
    })
  ).toThrow();
});

it.each([{ server: { entry: "./backend.ts" } }])(
  "accepts configured server entry points: %j",
  (override) => {
    expect(
      v.parse(tailorkitConfigSchema, { host: "https://host.test", ...override })
    ).toEqual({
      host: "https://host.test",
      ...override,
    });
  }
);

it("defaults entries while preserving backend enablement and migration configuration", () => {
  expect(
    v.parse(tailorkitConfigSchema, { host: "https://host.test", server: {} })
  ).toEqual({
    host: "https://host.test",
    server: { entry: "src/server.ts" },
  });
  expect(
    v.parse(tailorkitConfigSchema, {
      host: "https://host.test",
      server: { migrations: "./migrations" },
    })
  ).toEqual({
    host: "https://host.test",
    server: { entry: "src/server.ts", migrations: "./migrations" },
  });
});

it("rejects unsupported storage configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-invalid-config-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", storage: { entry: "./server.ts" } };'
    );
    await expect(loadTailorKitConfig(undefined, root)).rejects.toThrow(
      "Invalid key"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("rejects manual client entry configuration", () => {
  expect(() =>
    v.parse(tailorkitConfigSchema, {
      client: { entry: "./frontend.ts" },
      host: "https://host.test",
    })
  ).toThrow();
});
