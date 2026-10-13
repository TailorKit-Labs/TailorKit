import path from "node:path";
import { createRequire } from "node:module";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { validateLogoAsset } from "@tailorkit/asset-delivery/logo-validation";
import type { LogoContentType } from "@tailorkit/asset-delivery/logo-validation";
import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { loadTailorKitConfig } from "./config/loader";
import { assertSupportedPreactVersion } from "./preact-version";
import { readClientManifest } from "./builder/client-views";
import { buildServer, validateServerBuildOutput } from "./builder/server";
import { instanceExtractionPlugin } from "./builder/instances";
import { createFileRouteEntry, fileRoutesPlugin } from "./builder/file-routes";
import type { InstanceModule } from "./builder/instances";

import { createTailorKitUploadManifest } from "./builder/upload-manifest";

const preactPackageJson = "preact/package.json";
const preactPackageJsonModuleId = "\0tailorkit-preact-package-json";

export interface TailorKitPluginOptions {
  configPath?: string;
  cwd?: string;
}

/** Build the app client, private backend, migrations and deployment manifest. */
export async function tailorkit(options: TailorKitPluginOptions = {}): Promise<Plugin[]> {
  const loaded = await loadTailorKitConfig(options.configPath, options.cwd);
  loaded.root = await realpath(loaded.root);
  const serverEntry = path.resolve(loaded.root, loaded.config.server?.entry ?? "src/server.ts");
  const preactVersion = getInstalledPreactVersion(loaded.root);
  assertSupportedPreactVersion(preactVersion);

  let resolvedOutDir: string;
  let clientOutDir: string;
  let watching = false;
  let fileEntry: Awaited<ReturnType<typeof createFileRouteEntry>> | undefined;
  let serverWatcher: Awaited<ReturnType<typeof buildServer>>;
  let resolved: ResolvedConfig;
  let customPlugins: Plugin[] = [];
  const instanceModules = new Map<string, InstanceModule>();
  async function cleanup() {
    if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
    await fileEntry?.close();
  }
  const writeBuildExtras = async (): Promise<void> => {
    const { views, instanceResolvers } = await readClientManifest(
      path.join(clientOutDir, "client.js"),
    );
    const resolverNames = new Set(instanceResolvers.map((registration) => registration.resolver));
    const activeModules = [...instanceModules.values()]
      .map((module) => ({
        ...module,
        names: module.names.filter((name) => resolverNames.has(name)),
      }))
      .filter((module) => module.names.length)
      .sort((a, b) => a.filename.localeCompare(b.filename));
    if (
      activeModules.reduce((count, module) => count + module.names.length, 0) !== resolverNames.size
    ) {
      throw new Error(
        "Client references an instance resolver that was not extracted by the app build.",
      );
    }
    if (serverWatcher && "close" in serverWatcher) await serverWatcher.close();
    serverWatcher = await buildServer(
      loaded,
      watching,
      resolvedOutDir,
      activeModules,
      instanceResolvers,
      {
        mode: resolved.mode,
        resolve: resolved.resolve,
        define: resolved.define,
        plugins: customPlugins,
      },
    );
    const logoManifest: { dark?: string; light?: string } = {};
    for (const variant of ["light", "dark"] as const) {
      const configuredPath = loaded.config.logos?.[variant];
      if (!configuredPath) {
        continue;
      }
      const extension = path.extname(configuredPath).toLowerCase().slice(1);
      const contentType = { png: "image/png", svg: "image/svg+xml", webp: "image/webp" }[
        extension
      ] as LogoContentType | undefined;
      if (!contentType) {
        throw new Error(`The ${variant} logo must be an SVG, PNG, or WebP file.`);
      }
      const content = await readFile(path.resolve(loaded.root, configuredPath));
      validateLogoAsset(content, contentType);
      const filename = `logo-${variant}.${extension}`;
      await writeFile(path.join(clientOutDir, filename), content);
      logoManifest[variant] = `client/${filename}`;
    }
    await writeFile(path.join(clientOutDir, "views.json"), `${JSON.stringify(views)}\n`);
    await writeFile(
      path.join(resolvedOutDir, "tailorkit-upload.json"),
      `${JSON.stringify(createTailorKitUploadManifest(logoManifest, Boolean(loaded.config.server), views), null, 2)}\n`,
      "utf-8",
    );
  };
  const plugins: Plugin[] = [
    {
      name: "tailorkit",
      enforce: "pre",
      async config(config) {
        customPlugins = (await flattenPlugins(config.plugins ?? [])).filter(
          (plugin) => !plugins.includes(plugin),
        );
        watching = Boolean(config.build?.watch);
        resolvedOutDir = path.resolve(loaded.root, config.build?.outDir ?? ".tailorkit");
        validateServerBuildOutput(loaded, resolvedOutDir);
        clientOutDir = path.join(resolvedOutDir, "client");
        fileEntry = await createFileRouteEntry(loaded.root, resolvedOutDir, watching);
        return {
          root: loaded.root,
          define: {
            "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
            ...config.define,
          },
          oxc: { jsx: { importSource: "preact" } },
          build: {
            emptyOutDir: true,
            lib: { entry: fileEntry.entry, fileName: "client", formats: ["es"] },
            outDir: clientOutDir,
            minify: "oxc",
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
                comments: { annotation: false, jsdoc: false, legal: false },
                minify: true,
                minifyInternalExports: true,
              },
            },
          },
        };
      },
      configResolved(config) {
        resolved = config;
      },
      async writeBundle() {
        await writeBuildExtras();
      },
      async buildEnd(error) {
        if (error && !watching) await cleanup();
      },
      async closeBundle() {
        if (!watching) await cleanup();
      },
      closeWatcher: cleanup,
    },
    fileRoutesPlugin(loaded.root),
    instanceExtractionPlugin(loaded.root, Boolean(loaded.config.server), instanceModules),
    {
      name: "tailorkit-browser-server-boundary",
      enforce: "pre",
      async resolveId(id, importer) {
        if (
          /^(?:@tailorkit\/app\/server$|tailorkit\/(?:server|app\/server)$|effect(?:\/|$))/u.test(
            id,
          ) ||
          (importer && path.resolve(path.dirname(importer), id) === serverEntry)
        ) {
          throw new Error(
            "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type.",
          );
        }
        if (importer) {
          const result = await this.resolve(id, importer, { skipSelf: true });
          if (result?.id.split("?")[0] === serverEntry) {
            throw new Error(
              "App server implementations cannot be imported into a browser bundle. Import api from #tailorkit and server types with import type.",
            );
          }
        }
        return null;
      },
    },
    {
      name: "tailorkit-preact-package-json",
      enforce: "pre",
      resolveId(id) {
        return id === preactPackageJson ? preactPackageJsonModuleId : null;
      },
      load(id) {
        if (id === preactPackageJsonModuleId) {
          const version = JSON.stringify(preactVersion);
          return `export const version = ${version}; export default { version: ${version} };`;
        }
        return null;
      },
    },
  ];
  for (const plugin of plugins) plugin.apply = "build";
  return plugins;
}

async function flattenPlugins(option: PluginOption): Promise<Plugin[]> {
  const plugin = await option;
  if (!plugin) return [];
  if (Array.isArray(plugin)) return (await Promise.all(plugin.map(flattenPlugins))).flat();
  return [plugin];
}

function getInstalledPreactVersion(root: string): string {
  const require = createRequire(path.join(root, "package.json"));

  try {
    const packageJsonPath = require.resolve("preact/package.json");
    const packageJson = require(packageJsonPath) as { version?: unknown };

    if (typeof packageJson.version === "string") {
      return packageJson.version;
    }
  } catch (error) {
    throw new Error(
      `TailorKit requires Preact to build an app. Install preact@^11 and try again.`,
      { cause: error },
    );
  }

  throw new Error("Unable to read the installed Preact version.");
}
