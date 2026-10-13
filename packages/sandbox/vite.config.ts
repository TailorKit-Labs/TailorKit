import { resolve } from "node:path";

import { defineConfig } from "vite-plus";

import { iframeRuntimePlugin } from "./iframe-plugin.ts";

export default defineConfig({
  build: {
    lib: {
      entry: {
        host: resolve(import.meta.dirname, "src/host/index.ts"),
        protocol: resolve(import.meta.dirname, "src/protocol.ts"),
      },
      formats: ["es"],
      name: "@tailorkit/sandbox",
    },
    rolldownOptions: {
      external: [],
    },
  },
  plugins: [iframeRuntimePlugin()],
});
