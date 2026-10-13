import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: resolve(process.env.PLAYGROUND_DB_PATH ?? ".data/playground.sqlite") },
});
