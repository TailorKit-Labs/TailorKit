import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    deps: { alwaysBundle: [/^@tailorkit\/asset-delivery(?:\/|$)/u] },
    dts: true,
    entry: {
      builder: "src/builder/index.ts",
      config: "src/config/index.ts",
      "config-loader": "src/config/loader.ts",
      index: "src/index.ts",
    },
    format: "esm",
    target: "node20",
  },
  test: {
    hookTimeout: 5000,
    testTimeout: 5000,
  },
});
