import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: {
    index: "src/index.ts",
    builder: "src/builder/index.ts",
    config: "src/config/index.ts",
    "config-loader": "src/config/loader.ts",
  },
  format: ["esm"],
  noExternal: [/^@tailorkit\/asset-delivery(?:\/|$)/u],
  target: "node20",
});
