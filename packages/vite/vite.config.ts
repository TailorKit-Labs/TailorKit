import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    deps: { alwaysBundle: [/^@tailorkit\/asset-delivery(?:\/|$)/u] },
    dts: true,
    entry: {
      "app-link": "src/config/app-link.ts",
      builder: "src/builder/index.ts",
      config: "src/config/index.ts",
      "config-loader": "src/config/loader.ts",
      index: "src/index.ts",
      "upload-manifest": "src/builder/upload-manifest.ts",
    },
    format: "esm",
    target: "node20",
  },
  test: {
    // Build fixtures also launch Vite and Drizzle; avoid saturating CI CPUs.
    maxWorkers: 2,
  },
});
