import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as viteModule from "vite";
import type { BuildOptions, Plugin, ResolvedConfig } from "vite";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

interface BuildProjectOptions {
  cwd: string;
  mode?: string;
  outDir?: string;
  watch?: boolean;
}

/** Use the app's Vite installation and configuration for deployment. */
export const buildProject = async (options: BuildProjectOptions) => {
  const root = path.resolve(options.cwd);
  const require = createRequire(path.join(root, "package.json"));

  // SAFETY: The module path is resolved from the app's own installed Vite package, whose public build exports match this imported module contract.
  const { build } =
    /* oxlint-disable typescript/no-unsafe-type-assertion -- The module path is resolved from the app's own installed Vite package, whose public build exports match this imported module contract. */
    (await import(
      pathToFileURL(require.resolve("vite")).href
    )) as typeof viteModule;

  /* oxlint-enable typescript/no-unsafe-type-assertion */
  let resolved: ResolvedConfig | undefined;

  const outputPlugin: Plugin = {
    apply: (config) =>
      !(
        config.build?.ssr !== undefined &&
        config.build?.ssr !== false &&
        config.build?.ssr !== ""
      ),
    configResolved: (config) => {
      if (!config.plugins.some((plugin) => plugin.name === "patchsmith")) {
        throw new Error(
          "Add patchsmith() from patchsmith/vite to your vite.config.ts before deploying."
        );
      }

      resolved = config;
    },
    name: "patchsmith-deployment-output",
  };

  const buildOptions: BuildOptions = {
    watch: options.watch === true ? {} : null,
  };

  if (
    options.outDir !== undefined &&
    options.outDir !== null &&
    options.outDir !== ""
  ) {
    buildOptions.outDir = options.outDir;
  }

  const result = await build({
    build: buildOptions,
    mode: options.mode,
    plugins: [outputPlugin],
    root,
  });

  if ("on" in result) {
    const initialBuild = Promise.withResolvers<ReturnType<() => void>>();
    result.on("event", (event) => {
      if (event.code === "END") {
        initialBuild.resolve();
      }

      if (event.code === "ERROR") {
        initialBuild.reject(event.error);
      }
    });

    try {
      await initialBuild.promise;
    } catch (error) {
      await result.close();
      throw error;
    }
  }

  const outDir = path.dirname(
    path.resolve(
      requireValue(resolved).root,
      requireValue(resolved).build.outDir
    )
  );

  return { outDir, result };
};
