import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { validateLogoAsset } from "@tailorkit/asset-delivery/logo-validation";
import type { LogoContentType } from "@tailorkit/asset-delivery/logo-validation";
import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { z } from "zod";

import { readClientManifest } from "./builder/client-views";
import { getBuildEnvironment } from "./builder/env";
import { createFileRouteEntry, fileRoutesPlugin } from "./builder/file-routes";
import { instanceExtractionPlugin } from "./builder/instances";
import type { InstanceModule } from "./builder/instances";
import { buildServer, validateServerBuildOutput } from "./builder/server";
import { createTailorKitUploadManifest } from "./builder/upload-manifest";
import { loadTailorKitConfig } from "./config/loader";
import type { LoadedTailorKitConfig } from "./config/loader";
import { assertSupportedPreactVersion } from "./preact-version";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const preactPackageJson = "preact/package.json";

const preactPackageJsonModuleId = "\0tailorkit-preact-package-json";

export interface TailorKitPluginOptions {
  /** Config file path relative to vite.config.ts. Defaults to ./tailorkit.config.ts. */
  configPath?: string;
}

const flattenPlugins = async (option: PluginOption): Promise<Plugin[]> => {
  const plugin = await option;
  if (!(plugin !== undefined && plugin !== null && plugin !== false)) {
    return [];
  }
  if (Array.isArray(plugin)) {
    const awaitedResult1 = await Promise.all(plugin.map(flattenPlugins));
    return awaitedResult1.flat();
  }
  return [plugin];
};

const getInstalledPreactVersion = (root: string): string => {
  const require = createRequire(path.join(root, "package.json"));

  try {
    const packageJsonPath = require.resolve("preact/package.json");
    const packageJson = z
      .object({ version: z.string().optional() })
      .parse(require(packageJsonPath));

    if (packageJson.version !== undefined) {
      return packageJson.version;
    }
  } catch (error) {
    throw new Error(
      `TailorKit requires Preact to build an app. Install preact@^11 and try again.`,
      { cause: error }
    );
  }

  throw new Error("Unable to read the installed Preact version.");
};

/** Build the app client, private backend, migrations and deployment manifest. */
export const tailorkit = (options: TailorKitPluginOptions = {}): Plugin[] => {
  let loaded: LoadedTailorKitConfig;
  let serverEntry: string;
  let preactVersion: string;
  let outputDirectory: string;

  let resolvedOutDir: string;
  let clientOutDir: string;
  let watching = false;
  let fileEntry: Awaited<ReturnType<typeof createFileRouteEntry>> | undefined;
  let serverWatcher: Awaited<ReturnType<typeof buildServer>>;
  let resolved: ResolvedConfig;
  let customPlugins: Plugin[] = [];
  const instanceModules = new Map<string, InstanceModule>();
  const cleanup = async () => {
    if (serverWatcher && "close" in serverWatcher) {
      await serverWatcher.close();
    }
    await fileEntry?.close();
  };
  const writeBuildExtras = async (): Promise<void> => {
    const { views, instanceResolvers } = await readClientManifest(
      path.join(clientOutDir, "client.js")
    );
    const resolverNames = new Set(
      instanceResolvers.map((registration) => registration.resolver)
    );
    const activeModules = [...instanceModules.values()]
      .map((module) => ({
        ...module,
        names: module.names.filter((name) => resolverNames.has(name)),
      }))
      .filter((module) => module.names.length)
      .toSorted((a, b) => a.filename.localeCompare(b.filename));
    if (
      activeModules.reduce(
        (count, module) => count + module.names.length,
        0
      ) !== resolverNames.size
    ) {
      throw new Error(
        "Client references an instance resolver that was not extracted by the app build."
      );
    }
    if (serverWatcher && "close" in serverWatcher) {
      await serverWatcher.close();
    }
    serverWatcher = await buildServer(
      loaded,
      watching,
      resolvedOutDir,
      activeModules,
      instanceResolvers,
      {
        define: resolved.define,
        mode: resolved.mode,
        plugins: customPlugins,
        resolve: resolved.resolve,
      }
    );
    interface LogoManifest {
      dark?: string;
      light?: string;
    }
    const logoManifest: LogoManifest = {};
    for (const variant of ["light", "dark"] as const) {
      const configuredPath = loaded.config.logos?.[variant];
      if (
        !(
          configuredPath !== undefined &&
          configuredPath !== null &&
          configuredPath !== ""
        )
      ) {
        continue;
      }
      const extension = path.extname(configuredPath).toLowerCase().slice(1);
      const contentType = new Map<string, LogoContentType>([
        ["png", "image/png"],
        ["svg", "image/svg+xml"],
        ["webp", "image/webp"],
      ]).get(extension);
      if (!contentType) {
        throw new Error(
          `The ${variant} logo must be an SVG, PNG, or WebP file.`
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Process the validation and dependent file IO in order; fail before advancing on error.
      const content = await readFile(path.resolve(loaded.root, configuredPath));
      validateLogoAsset(content, contentType);
      const filename = `logo-${variant}.${extension}`;
      // oxlint-disable-next-line no-await-in-loop -- Process the validation and dependent file IO in order; fail before advancing on error.
      await writeFile(path.join(clientOutDir, filename), content);
      logoManifest[variant] = `client/${filename}`;
    }
    await writeFile(
      path.join(clientOutDir, "views.json"),
      `${JSON.stringify(views)}\n`
    );
    await writeFile(
      path.join(resolvedOutDir, "tailorkit-upload.json"),
      `${JSON.stringify(createTailorKitUploadManifest(logoManifest, Boolean(loaded.config.server), views), null, 2)}\n`,
      "utf-8"
    );
  };
  const plugins: Plugin[] = [
    {
      buildEnd: async (error) => {
        if (error && !watching) {
          await cleanup();
        }
      },
      closeBundle: async () => {
        if (!watching) {
          await cleanup();
        }
      },
      closeWatcher: cleanup,
      config: async (config) => {
        const awaitedResult2 = await flattenPlugins(config.plugins ?? []);
        customPlugins = awaitedResult2.filter(
          (plugin) => !plugins.includes(plugin)
        );
        watching = Boolean(config.build?.watch);
        outputDirectory = config.build?.outDir ?? ".tailorkit";
        return {
          build: {
            emptyOutDir: true,
            lib: {
              entry: "tailorkit:client-entry",
              fileName: "client",
              formats: ["es"],
            },
            minify: "oxc",
            outDir: path.join(outputDirectory, "client"),
            rolldownOptions: {
              output: {
                comments: { annotation: false, jsdoc: false, legal: false },
                inlineDynamicImports: true,
                minify: true,
                minifyInternalExports: true,
              },
            },
          },
          define: {
            "process.env.NODE_ENV": JSON.stringify(
              getBuildEnvironment().NODE_ENV ?? "production"
            ),
            ...config.define,
          },
          oxc: { jsx: { importSource: "preact" } },
        };
      },
      configResolved: async (config) => {
        const root =
          config.configFile !== undefined &&
          config.configFile !== null &&
          config.configFile !== ""
            ? path.dirname(config.configFile)
            : config.root;
        loaded = await loadTailorKitConfig(
          path.resolve(root, options.configPath ?? "tailorkit.config.ts")
        );
        loaded.root = await realpath(root);
        serverEntry = path.resolve(
          loaded.root,
          loaded.config.server?.entry ?? "src/server.ts"
        );
        preactVersion = getInstalledPreactVersion(loaded.root);
        assertSupportedPreactVersion(preactVersion);
        resolvedOutDir = path.resolve(loaded.root, outputDirectory);
        validateServerBuildOutput(loaded, resolvedOutDir);
        clientOutDir = path.join(resolvedOutDir, "client");
        fileEntry = await createFileRouteEntry(
          loaded.root,
          resolvedOutDir,
          watching
        );
        for (const build of [
          config.build,
          requireValue(config.environments.client).build,
        ]) {
          build.outDir = clientOutDir;
          if (build.lib !== false) {
            build.lib.entry = fileEntry.entry;
          }
        }
        resolved = config;
      },
      enforce: "pre",
      name: "tailorkit",
      writeBundle: async () => {
        await writeBuildExtras();
      },
    },
    fileRoutesPlugin(() => loaded.root),
    instanceExtractionPlugin(
      () => loaded.root,
      () => Boolean(loaded.config.server),
      instanceModules
    ),
    {
      enforce: "pre",
      name: "tailorkit-browser-server-boundary",
      async resolveId(id, importer) {
        if (
          /^(?:@tailorkit\/app\/server$|tailorkit\/(?:server|app\/server)$|effect(?:\/|$))/u.test(
            id
          ) ||
          (importer !== undefined &&
            importer !== null &&
            importer !== "" &&
            path.resolve(path.dirname(importer), id) === serverEntry)
        ) {
          throw new Error(
            "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type."
          );
        }
        if (importer !== undefined && importer !== null && importer !== "") {
          const result = await this.resolve(id, importer, { skipSelf: true });
          if (result?.id.split("?")[0] === serverEntry) {
            throw new Error(
              "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type."
            );
          }
        }
        return null;
      },
    },
    {
      enforce: "pre",
      load: (id) => {
        if (id === preactPackageJsonModuleId) {
          const version = JSON.stringify(preactVersion);
          return `export const version = ${version}; export default { version: ${version} };`;
        }
        return null;
      },
      name: "tailorkit-preact-package-json",
      resolveId: (id) =>
        id === preactPackageJson ? preactPackageJsonModuleId : null,
    },
  ];
  for (const plugin of plugins) {
    plugin.apply = "build";
  }
  return plugins;
};
