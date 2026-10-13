import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { relations } from "@tailorkit/db/relations";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const apiDir = import.meta.dirname;
const migrationsDir = resolve(apiDir, "../../../db/src/migrations");

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({
    client,
    relations,
  });

  await migrate(db, { migrationsFolder: migrationsDir });

  return { client, db };
}
