import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { createDatabaseTestApp } from "../test-utils";
import { readAppMigrations } from "./migrations";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

it("packages generated SQL with stable checksums and tracks the source files", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "tailorkit-generated-migrations-")
  );
  try {
    await createDatabaseTestApp(root);
    const { migrations, files } = await readAppMigrations(
      path.join(root, "src/db/migrations")
    );
    expect(migrations).toHaveLength(1);
    const sql = await readFile(requireValue(files[1]), "utf-8");
    expect(sql).toContain("CREATE TABLE `todos`");
    expect(migrations[0]).toEqual({
      hash: createHash("sha256").update(sql).digest("hex"),
      id: path.basename(path.dirname(requireValue(files[1]))),
      statements: [sql.trim()],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}, 60_000);

it("allows an absent default directory but fails for missing configured migrations or malformed files", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "tailorkit-migration-reader-")
  );
  try {
    const missing = path.join(root, "missing");
    const awaitedResult1 = await readAppMigrations(missing, true);
    expect(awaitedResult1.migrations).toEqual([]);
    await expect(readAppMigrations(missing)).rejects.toThrow(
      "Run tailorkit db generate"
    );
    const directory = path.join(root, "20261001000000_init");
    await mkdir(directory);
    await expect(readAppMigrations(root)).rejects.toThrow();
    await writeFile(path.join(directory, "migration.sql"), "");
    await expect(readAppMigrations(root)).rejects.toThrow(
      "App migration is empty"
    );
    await rm(directory, { recursive: true });
    await mkdir(path.join(root, "meta"));
    await expect(readAppMigrations(root)).rejects.toThrow(
      "Use Drizzle Kit v1 migrations"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
