import { fileURLToPath } from "node:url";

import { build } from "vite";
import type { Plugin } from "vite";

const moduleId = "virtual:tailorkit-iframe";

/** Bundle the isolated runtime as an inline script, with no runtime network imports. */
export function iframeRuntimePlugin(): Plugin {
  return {
    async load(id) {
      if (id !== `\0${moduleId}`) {
        return;
      }
      const result = await build({
        configFile: false,
        logLevel: "silent",
        build: {
          write: false,
          minify: true,
          lib: {
            entry: fileURLToPath(
              new URL("src/iframe/entry.ts", import.meta.url)
            ),
            name: "TailorKitIframe",
            formats: ["iife"],
          },
        },
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
    resolveId(id) {
      if (id === moduleId) {
        return `\0${moduleId}`;
      }
    },
  };
}
