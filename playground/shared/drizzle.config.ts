import { resolve } from "node:path";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: resolve(process.env.PLAYGROUND_DB_PATH ?? ".data/playground.sqlite"),
  },
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
});
