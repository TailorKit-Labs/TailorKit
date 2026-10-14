import { fileURLToPath } from "node:url";

import { build } from "vite";
import type { Plugin } from "vite";

const moduleId = "virtual:tailorkit-iframe";

/** Bundle the isolated runtime as an inline script, with no runtime network imports. */
export const iframeRuntimePlugin = (): Plugin => ({
  load: async (id): Promise<string | undefined> => {
    if (id !== `\0${moduleId}`) {
      return undefined;
    }
    const result = await build({
      build: {
        lib: {
          entry: fileURLToPath(new URL("src/iframe/entry.ts", import.meta.url)),
          formats: ["iife"],
          name: "TailorKitIframe",
        },
        minify: true,
        write: false,
      },
      configFile: false,
      logLevel: "silent",
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !("output" in output)) {
      throw new Error("Unable to bundle TailorKit iframe.");
    }
    const chunk = output.output.find((item) => item.type === "chunk");
    if (!chunk) {
      throw new Error("TailorKit iframe bundle is empty.");
    }
    return `export default ${JSON.stringify(chunk.code)};`;
  },
  name: "tailorkit-iframe",
  resolveId: (id) => (id === moduleId ? `\0${moduleId}` : undefined),
});
