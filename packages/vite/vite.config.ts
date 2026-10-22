import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    deps: { alwaysBundle: [/^@patchsmith\/asset-delivery(?:\/|$)/u] },
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
    target: "node22",
  },
  test: {
    // Watch assertions span client and server rebuilds on shared CI runners.
    expect: { poll: { timeout: 10_000 } },
    // Build fixtures also launch Vite and Drizzle; avoid saturating CI CPUs.
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
