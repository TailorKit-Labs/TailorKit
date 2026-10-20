import { mkdirSync } from "node:fs";
import nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-sqlite";

import { env } from "../env";
import * as schema from "./schema";

const { dirname, resolve } = nodePath;

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const databasePath =
  env.PLAYGROUND_DB_PATH ?? resolve(packageRoot, ".data/playground.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new DatabaseSync(databasePath);

sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle({ client: sqlite, schema });

// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "./schema";
