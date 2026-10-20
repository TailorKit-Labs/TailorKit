import nodePath from "node:path";

import { defineConfig } from "vite-plus";

import { iframeRuntimePlugin } from "./iframe-plugin.ts";

const { resolve } = nodePath;

export default defineConfig({
  build: {
    lib: {
      entry: {
        host: resolve(import.meta.dirname, "src/host/index.ts"),
        protocol: resolve(import.meta.dirname, "src/protocol.ts"),
      },
      formats: ["es"],
      name: "@patchsmith/sandbox",
    },
    rolldownOptions: {
      external: [],
    },
    target: "node22",
  },
  plugins: [iframeRuntimePlugin()],
});
