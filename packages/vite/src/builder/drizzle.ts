import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { appDatabasePaths } from "./database-paths";

/** Use the app's Drizzle version with explicit flags; no Drizzle config file is needed. */
export const drizzleGenerateArguments = async (
  root: string,
  output: string,
  name?: string
) => {
  const require = createRequire(path.join(root, "package.json"));

  const candidates = await Promise.all(
    (require.resolve.paths("drizzle-kit") ?? []).map(async (directory) => {
      const cli = path.join(directory, "drizzle-kit/bin.cjs");

      try {
        await access(cli);

        return cli;
      } catch {
        return null;
      }
    })
  );

  const cli = candidates.find((candidate) => candidate !== null);

  if (cli !== undefined && cli !== null && cli !== "") {
    return [
      "--preserve-symlinks-main",
      cli,
      "generate",
      "--dialect",
      "sqlite",
      "--schema",
      appDatabasePaths(root).schema,
      "--out",
      output,
      ...(name === undefined ? [] : ["--name", name]),
    ];
  }

  throw new Error(
    "Install drizzle-kit and drizzle-orm as dev dependencies, then run patchsmith db generate."
  );
};
