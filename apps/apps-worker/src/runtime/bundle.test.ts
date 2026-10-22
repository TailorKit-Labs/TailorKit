import { defineRouter, fn } from "@patchsmith/app/server";
import { expect, it, vi } from "vite-plus/test";

import { createApplicationExecution } from "./bundle";

const application = {
  default: {
    functions: defineRouter({ value: fn.query.handler(() => "ready") }),
  },
  migrations: [],
  runtimeManifest: { apiVersion: 1, requires: ["database", "actions"] },
};

const persistence = () => {
  const transactions = vi.fn();

  return {
    execute: vi.fn(() => ({ changes: 0, columns: [], rows: [] })),
    transaction<T>(run: () => T): T {
      transactions();

      return run();
    },
    transactions,
  };
};

it.each([
  [],
  ["database"],
  ["database", "actions"],
  ["database", "actions", "database-relations", "tools"],
])("accepts supported required features %j", (...requires: string[]) => {
  const db = persistence();

  const execution = createApplicationExecution(
    { ...application, runtimeManifest: { apiVersion: 1, requires } },
    db
  );

  expect(
    execution.query(
      { name: "value" },
      {
        appId: "a",
        deploymentId: "d",
        expiresAt: Date.now() + 60_000,
        installationId: "i",
        projectId: "p",
        scope: { name: "org", value: { id: "tenant" } },
        subjectId: "u",
        toolUrl: "https://host.test/api/patchsmith/tools/execute",
      }
    ).value
  ).toBe("ready");
});

it.each([
  { ...application, runtimeManifest: undefined },
  { ...application, runtimeManifest: { apiVersion: 2, requires: [] } },
  {
    ...application,
    runtimeManifest: { apiVersion: 1, requires: ["scheduling"] },
  },
  { ...application, default: null },
  { ...application, migrations: undefined },
])("rejects incompatible exports before any database access", (module) => {
  const db = persistence();
  expect(() => createApplicationExecution(module, db)).toThrow();

  try {
    createApplicationExecution(module, db);
  } catch (error) {
    expect(error).toMatchObject({ code: "INCOMPATIBLE_VERSION" });
  }

  expect(db.execute).not.toHaveBeenCalled();
  expect(db.transactions).not.toHaveBeenCalled();
});

it("ignores additional module exports for additive features", () => {
  expect(() =>
    createApplicationExecution(
      { ...application, optionalMetadata: {} },
      persistence()
    )
  ).not.toThrow();
});
