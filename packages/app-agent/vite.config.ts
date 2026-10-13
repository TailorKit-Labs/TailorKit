import { readFileSync } from "node:fs";

import { defineConfig } from "vite-plus";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    clean: true,
    deps: { neverBundle: Object.keys(packageJson.dependencies) },
    dts: true,
    entry: ["src/index.ts", "src/workflows.ts", "src/mcp.ts"],
    format: "esm",
    minify: false,
    plugins: [
      {
        load(id) {
          if (id.endsWith(".md?raw")) {
            return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf-8"))};`;
          }
        },
        name: "instructions-raw",
      },
    ],
    sourcemap: true,
    target: "node24",
  },
});
