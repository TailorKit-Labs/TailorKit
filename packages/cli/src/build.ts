import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";

interface BuildProjectOptions {
  cwd: string;
  mode?: string;
  outDir?: string;
  watch?: boolean;
}

/** Use the app's Vite installation and configuration for deployment. */
export async function buildProject(options: BuildProjectOptions) {
  const root = path.resolve(options.cwd);
  const require = createRequire(path.join(root, "package.json"));
  const { build } = (await import(
    pathToFileURL(require.resolve("vite")).href
  )) as typeof import("vite");
  let outDir = "";
  const outputPlugin: Plugin = {
    name: "tailorkit-deployment-output",
    apply: (config) => !config.build?.ssr,
    configResolved(config) {
      if (!config.plugins.some((plugin) => plugin.name === "tailorkit")) {
        throw new Error(
          "Add tailorkit() from tailorkit/vite to your vite.config.ts before deploying.",
        );
      }
      outDir = path.dirname(path.resolve(config.root, config.build.outDir));
    },
  };
  const result = await build({
    root,
    mode: options.mode,
    build: {
      ...(options.outDir ? { outDir: options.outDir } : {}),
      watch: options.watch ? {} : null,
    },
    plugins: [outputPlugin],
  });
  if ("on" in result) {
    await new Promise<void>((resolve, reject) => {
      result.on("event", (event) => {
        if (event.code === "END") resolve();
        if (event.code === "ERROR") reject(event.error);
      });
    }).catch(async (error: unknown) => {
      await result.close();
      throw error;
    });
  }
  return { result, outDir };
}
