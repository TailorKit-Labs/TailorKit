import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-sqlite";

import * as schema from "./schema";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const databasePath =
  process.env.PLAYGROUND_DB_PATH ??
  resolve(packageRoot, ".data/playground.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new DatabaseSync(databasePath);
sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle({ client: sqlite, schema });
export * from "./schema";
