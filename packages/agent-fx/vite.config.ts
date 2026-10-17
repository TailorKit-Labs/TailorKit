import { defineConfig } from "vite-plus";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    deps: { neverBundle: Object.keys(packageJson.dependencies) },
    dts: true,
    entry: ["src/index.ts", "src/workflows.ts"],
    format: "esm",
    target: "node24",
  },
});
