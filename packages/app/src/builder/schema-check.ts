import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { appDatabasePaths } from "./database-paths";
import { drizzleGenerateArguments } from "./drizzle";
import { getBuildEnvironment } from "./env";

const run = promisify(execFile);

interface Snapshot {
  version: string;
  dialect: string;
  ddl: unknown[];
}

const snapshot = async (directory: string): Promise<Snapshot | undefined> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  const latest = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .at(-1);
  if (!latest) {
    return;
  }
  const filename = path.join(directory, latest, "snapshot.json");
  const value = JSON.parse(
    await readFile(filename, "utf-8")
  ) as Partial<Snapshot>;
  if (
    value.version !== "7" ||
    value.dialect !== "sqlite" ||
    !Array.isArray(value.ddl)
  ) {
    throw new Error(
      `Unsupported app schema snapshot: ${filename}. Use Drizzle Kit v1 SQLite migrations.`
    );
  }
  return value as Snapshot;
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/** Generate a fresh snapshot with Drizzle in disposable storage, leaving committed history unchanged. */
export const checkAppSchema = async (
  root: string,
  migrationsDirectory: string
) => {
  const { schema } = appDatabasePaths(root);
  try {
    await access(schema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  const temporary = await mkdtemp(
    path.join(tmpdir(), "tailorkit-schema-check-")
  );
  try {
    const { stdout } = await run(
      process.execPath,
      await drizzleGenerateArguments(root, temporary),
      {
        cwd: root,
        env: { ...getBuildEnvironment(), CI: "true" },
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }
    ).catch((error: unknown) => {
      throw new Error(
        `Could not check the app database schema with Drizzle Kit. Check ${path.relative(root, schema)} and your drizzle-kit/drizzle-orm dependencies.`,
        { cause: error }
      );
    });
    const current = await snapshot(temporary);
    if (!current && !stdout.includes("No schema changes")) {
      throw new Error(
        `Drizzle Kit did not produce a schema snapshot. Check ${path.relative(root, schema)} and run tailorkit db generate.`
      );
    }
    const saved = await snapshot(migrationsDirectory);
    const expected = (current?.ddl ?? []).map(canonical).toSorted();
    const actual = (saved?.ddl ?? []).map(canonical).toSorted();
    if (canonical(expected) !== canonical(actual)) {
      throw new Error(
        `App database migrations are missing or out of sync with ${path.relative(root, schema)}. Run tailorkit db generate, commit the generated files in ${path.relative(root, migrationsDirectory)}, then build again.`
      );
    }
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
};
