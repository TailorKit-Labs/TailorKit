import { fileURLToPath } from "node:url";

import { build, defineConfig } from "vite";

import { iframeRuntimePlugin } from "../iframe-plugin";

export default defineConfig({
  plugins: [
    iframeRuntimePlugin(),
    {
      load: async (id): Promise<string | undefined> => {
        if (id !== "\0canvas-client") {
          return undefined;
        }

        const result = await build({
          build: {
            lib: {
              entry: fileURLToPath(new URL("client.ts", import.meta.url)),
              formats: ["es"],
            },
            write: false,
          },
          configFile: false,
          logLevel: "silent",
        });

        const output = Array.isArray(result) ? result[0] : result;

        const chunk =
          output && "output" in output
            ? output.output.find((item) => item.type === "chunk")
            : undefined;

        if (!chunk) {
          throw new Error("Benchmark app bundle is empty.");
        }

        return `export default ${JSON.stringify(chunk.code)}`;
      },
      name: "canvas-benchmark-client",
      resolveId: (id) =>
        id === "virtual:canvas-client" ? "\0canvas-client" : undefined,
    },
  ],
  root: import.meta.dirname,
});
