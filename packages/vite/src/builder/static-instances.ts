import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import * as v from "valibot";
import { build } from "vite";
import type { UserConfig } from "vite";

import {
  instanceServerBindings,
  instanceServerImports,
  instanceServerPlugin,
} from "./instances";
import type { InstanceModule, InstanceRegistration } from "./instances";
import { staticInstancesSchema } from "./upload-manifest";

const evaluate = `
import { pathToFileURL } from "node:url";
const { default: resolve } = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write("\\nPATCHSMITH_STATIC=" + JSON.stringify(await resolve()));
process.exit(0);
`;

/** App code executes only in the developer's build process, never in the host or platform. */
export const buildStaticInstances = async (
  root: string,
  output: string,
  modules: InstanceModule[],
  registrations: InstanceRegistration[],
  viteConfig: UserConfig,
  addWatchFile: (filename: string) => void
) => {
  const unique = [
    ...new Map(registrations.map((entry) => [entry.resolver, entry])).values(),
  ];

  if (!unique.length) {
    return {};
  }

  const temporaryRoot = path.join(output, "tmp");
  await mkdir(temporaryRoot, { recursive: true });

  const temporary = await mkdtemp(
    path.join(temporaryRoot, "static-instances-")
  );

  const entry = path.join(temporary, "entry.mjs");

  try {
    await writeFile(
      entry,
      `
import { resolveStaticInstances } from "patchsmith/internal/server";
${instanceServerImports(modules)}
const definitions = ${instanceServerBindings(modules, unique)};
const names = ${JSON.stringify(unique.map(({ resolver }) => resolver))};
export default async () => await resolveStaticInstances(definitions.map((definition, index) => ({ ...definition, name: names[index] })));
`
    );
    await build({
      build: {
        emptyOutDir: false,
        outDir: temporary,
        rolldownOptions: {
          external: [],
          output: { entryFileNames: "static.mjs", inlineDynamicImports: true },
        },
        ssr: entry,
        target: "es2022",
      },
      configFile: false,
      define: viteConfig.define,
      mode: viteConfig.mode,
      plugins: [
        ...(viteConfig.plugins ?? []),
        instanceServerPlugin(root, modules),
        {
          buildEnd() {
            for (const id of this.getModuleIds()) {
              const [filename] = id.split("?");

              if (
                filename !== undefined &&
                filename !== "" &&
                filename !== entry &&
                path.isAbsolute(filename)
              ) {
                addWatchFile(filename);
              }
            }
          },
          name: "patchsmith-static-instances",
          async resolveId(id) {
            if (id !== "patchsmith/internal/server") {
              return null;
            }

            return await this.resolve(id, path.join(root, "package.json"), {
              skipSelf: true,
            });
          },
        },
      ],
      resolve: viteConfig.resolve,
      root,
      ssr: { noExternal: true },
    });

    // oxlint-disable-next-line typescript/strict-void-return -- Node supports promisify(execFile); the ChildProcess return is intentionally ignored.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        evaluate,
        path.join(temporary, "static.mjs"),
      ],
      { cwd: root, maxBuffer: 2 * 1024 * 1024, timeout: 10_000 }
    );

    const marker = "\nPATCHSMITH_STATIC=";
    const index = stdout.lastIndexOf(marker);

    if (index === -1) {
      throw new Error("Static instance evaluation produced no snapshot.");
    }

    return v.parse(
      v.record(v.string(), staticInstancesSchema),
      JSON.parse(stdout.slice(index + marker.length))
    );
  } catch (error) {
    throw new Error(
      "Unable to build static instances. Resolvers must return JSON-compatible entries without runtime arguments.",
      { cause: error }
    );
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
};
