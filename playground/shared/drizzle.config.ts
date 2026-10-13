import nodePath from "node:path";

import { defineConfig } from "drizzle-kit";

import { env } from "./src/env";

const { resolve } = nodePath;

export default defineConfig({
  dbCredentials: {
    url: resolve(env.PLAYGROUND_DB_PATH ?? ".data/playground.sqlite"),
  },
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
});
