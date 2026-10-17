import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as v from "valibot";

import { appDatabasePaths } from "./database-paths";
import { drizzleGenerateArguments } from "./drizzle";
import { getBuildEnvironment } from "./env";
import { isMissingFile } from "./fs-errors";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

// oxlint-disable-next-line typescript/strict-void-return -- Node explicitly supports promisify(execFile); its ChildProcess return is intentionally ignored by the callback-to-Promise adapter.
const run = promisify(execFile);

interface Snapshot {
  version: string;
  dialect: string;
  ddl: unknown[];
}

const snapshot = async (directory: string): Promise<Snapshot | undefined> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: ErrorOptions["cause"]) => {
      if (isMissingFile(error)) {
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
  if (!(latest !== undefined && latest !== null && latest !== "")) {
    return undefined;
  }
  const filename = path.join(directory, latest, "snapshot.json");
  const parsed = v.safeParse(
    v.object({
      ddl: v.array(v.unknown()),
      dialect: v.literal("sqlite"),
      version: v.literal("7"),
    }),
    JSON.parse(await readFile(filename, "utf-8"))
  );
  if (!parsed.success) {
    throw new Error(
      `Unsupported app schema snapshot: ${filename}. Use Drizzle Kit v1 SQLite migrations.`
    );
  }
  return parsed.output;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser, serializer, or runtime adapter handles arbitrary values before validating or encoding their domain representation.
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isObjectValue(value)) {
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
    if (isMissingFile(error)) {
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
    ).catch((error: ErrorOptions["cause"]) => {
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
