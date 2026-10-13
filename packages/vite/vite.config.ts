import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      builder: "src/builder/index.ts",
      config: "src/config/index.ts",
      "config-loader": "src/config/loader.ts",
    },
    format: "esm",
    dts: true,
    clean: true,
    target: "node20",
    deps: { alwaysBundle: [/^@tailorkit\/asset-delivery(?:\/|$)/u] },
  },
});
