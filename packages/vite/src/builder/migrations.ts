import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AppMigration } from "@patchsmith/app/protocol";

import { forEachSequential } from "#for-each-sequential";

import { isMissingFile } from "./fs-errors";

/** Read the timestamped migration folders produced by the workspace's Drizzle Kit version. */
export const readAppMigrations = async (
  directory: string,
  optional = false
) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: ErrorOptions["cause"]) => {
      if (isMissingFile(error)) {
        if (optional) {
          return [];
        }

        throw new Error(
          `App migrations directory is missing: ${directory}. Run patchsmith db generate and commit migrations before building.`,
          { cause: error }
        );
      }

      throw error;
    }
  );

  const migrations: AppMigration[] = [];
  const files = [directory];

  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  await forEachSequential(names, async (name) => {
    if (!/^\d{14}_[\w-]+$/u.test(name)) {
      throw new Error(
        `Unsupported app migration folder: ${name}. Use Drizzle Kit v1 migrations.`
      );
    }

    const file = path.join(directory, name, "migration.sql");

    const sql = await readFile(file, "utf-8");

    const statements = sql
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean);

    if (!statements.length) {
      throw new Error(`App migration is empty: ${name}`);
    }

    migrations.push({
      hash: createHash("sha256").update(sql).digest("hex"),
      id: name,
      statements,
    });
    files.push(file);
  });

  return { files, migrations };
};
