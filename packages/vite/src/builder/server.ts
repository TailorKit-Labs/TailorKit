import { mkdir, mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";

import type { RuntimeManifest } from "@tailorkit/app/server";
import { build } from "vite";
import type { UserConfig } from "vite";

import type { LoadedTailorKitConfig } from "../config/loader";
import { appDatabasePaths } from "./database-paths";
import { isMissingFile } from "./fs-errors";
import {
  instanceServerBindings,
  instanceServerImports,
  instanceServerPlugin,
} from "./instances";
import type { InstanceModule, InstanceRegistration } from "./instances";
import { readAppMigrations } from "./migrations";
import { checkAppSchema } from "./schema-check";

const containsImplementation = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
};

const overlaps = (source: string, destination: string) => {
  const contains = containsImplementation;
  return contains(source, destination) || contains(destination, source);
};

/** Check before either build can empty an output directory. */
export const validateServerBuildOutput = (
  loaded: LoadedTailorKitConfig,
  output: string
) => {
  if (!loaded.config.server) {
    return;
  }
  const migrationsDirectory = appDatabasePaths(
    loaded.root,
    loaded.config.server.migrations
  ).migrations;
  for (const name of ["server", "client", "migrations", "tmp"]) {
    if (overlaps(migrationsDirectory, path.join(output, name))) {
      throw new Error("App build output must not overlap migration source");
    }
  }
};

/** Emitted by this SDK's builder; breaking interface changes increment apiVersion. */
export const runtimeManifest = {
  apiVersion: 1,
  requires: ["database", "actions", "database-relations", "tools"],
} as const satisfies RuntimeManifest;

/** Bundle the private app backend and migrations. */
export const buildServer = async (
  loaded: LoadedTailorKitConfig,
  watch = false,
  buildOutDir?: string,
  instances: InstanceModule[] = [],
  registrations: InstanceRegistration[] = [],
  viteConfig: UserConfig = {}
) => {
  const config = loaded.config.server;
  if (!config) {
    return;
  }
  const output = buildOutDir ?? path.resolve(loaded.root, ".tailorkit");
  const directory = path.join(output, "server");
  const migrationsDirectory = appDatabasePaths(
    loaded.root,
    config.migrations
  ).migrations;
  const migrationsOutput = path.join(output, "migrations");
  const temporaryRoot = path.join(output, "tmp");
  validateServerBuildOutput(loaded, output);
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "server-"));
  const entry = path.join(temporary, "entry.mjs");
  let watching = false;
  let ready: (() => void) | undefined;
  const initialBuild = watch
    ? (() => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<ReturnType<() => void>>();
        try {
          ready = resolve;
        } catch (error) {
          rejectPending(error);
        }
        return pendingPromise;
      })()
    : undefined;
  try {
    await writeFile(
      entry,
      `${
        instances.length
          ? `import app from ${JSON.stringify(path.resolve(loaded.root, config.entry ?? "src/server.ts"))};\nimport { withInstanceResolvers } from "tailorkit/server";\n${instanceServerImports(instances)}\nexport default withInstanceResolvers(app, ${instanceServerBindings(instances, registrations)});`
          : `export { default } from ${JSON.stringify(path.resolve(loaded.root, config.entry ?? "src/server.ts"))};`
      }
export { default as migrations } from "tailorkit:migrations";
export const runtimeManifest = ${JSON.stringify(runtimeManifest)};
`
    );
    const result = await build({
      build: {
        emptyOutDir: false,
        minify: "oxc",
        outDir: directory,
        rollupOptions: {
          external: [],
          output: {
            entryFileNames: "server.js",
            inlineDynamicImports: true,
            minify: true,
            minifyInternalExports: true,
          },
        },
        ssr: entry,
        target: "es2022",
        watch: watch ? {} : null,
      },
      configFile: false,
      define: viteConfig.define,
      mode: viteConfig.mode,
      plugins: [
        ...(viteConfig.plugins ?? []),
        instanceServerPlugin(loaded.root, instances),
        {
          closeWatcher: () => rm(temporary, { force: true, recursive: true }),
          async load(id) {
            if (id !== "\0tailorkit:migrations") {
              return;
            }
            const { migrations, files } = await readAppMigrations(
              migrationsDirectory,
              config.migrations === undefined
            );
            await checkAppSchema(loaded.root, migrationsDirectory);
            this.addWatchFile(appDatabasePaths(loaded.root).schema);
            for (const file of files) {
              this.addWatchFile(file);
            }
            await rm(migrationsOutput, { force: true, recursive: true });
            await mkdir(migrationsOutput, { recursive: true });
            await cp(migrationsDirectory, migrationsOutput, {
              recursive: true,
            }).catch((error: ErrorOptions["cause"]) => {
              if (config.migrations === undefined && isMissingFile(error)) {
                return;
              }
              throw error;
            });
            return `export default ${JSON.stringify(migrations)};`;
          },
          name: "tailorkit-app-migrations",
          resolveId(id) {
            if (id === "tailorkit:migrations") {
              return "\0tailorkit:migrations";
            }
          },
        },
      ],
      resolve: viteConfig.resolve,
      root: loaded.root,
      ssr: { noExternal: true },
    });
    watching = watch;
    if (watch && "on" in result && initialBuild) {
      try {
        await Promise.race([
          initialBuild,
          (() => {
            const {
              promise: pendingPromise,
              resolve: _,
              reject,
            } = Promise.withResolvers<never>();
            try {
              result.on("event", (event) => {
                if (event.code === "ERROR") {
                  reject(event.error);
                }
                if (event.code === "END") {
                  ready?.();
                }
              });
            } catch (error) {
              reject(error);
            }
            return pendingPromise;
          })(),
        ]);
      } catch (error) {
        await result.close();
        throw error;
      }
    }
    return result;
  } finally {
    if (!watching) {
      await rm(temporary, { force: true, recursive: true });
    }
  }
};
