import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import { loadPatchsmithConfig } from "#config/loader";

import { appDatabasePaths } from "./database-paths";
import { drizzleGenerateArguments } from "./drizzle";
import { checkAppSchema } from "./schema-check";

export interface GenerateAppMigrationsOptions {
  configPath?: string;
  cwd?: string;
  name?: string;
}

export const generateAppMigrations = async (
  options: GenerateAppMigrationsOptions = {}
) => {
  const loaded = await loadPatchsmithConfig(options.configPath, options.cwd);

  const paths = appDatabasePaths(loaded.root, loaded.config.server?.migrations);
  await access(paths.schema).catch((error: ErrorOptions["cause"]) => {
    throw new Error(
      `Define the app database schema in ${path.relative(loaded.root, paths.schema)} before generating migrations.`,
      { cause: error }
    );
  });
  const directory = paths.migrations;

  const args = await drizzleGenerateArguments(
    loaded.root,
    directory,
    options.name
  );

  await (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject,
    } = Promise.withResolvers<ReturnType<() => void>>();

    try {
      // Keep Drizzle's rename prompts available during explicit generation.
      const child = spawn(process.execPath, args, {
        cwd: loaded.root,
        stdio: "inherit",
      });

      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Drizzle migration generation failed (${signal ?? code}).`
            )
          );
        }
      });
    } catch (error) {
      reject(error);
    }

    await pendingPromise;
  })();
  await checkAppSchema(loaded.root, directory);

  return directory;
};
