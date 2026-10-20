import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: false,
    entry: {
      client: "src/client/index.ts",
      index: "src/index.ts",
      "store-fetch": "src/store/fetch/index.ts",
      "store-local": "src/store/local/index.ts",
    },
    fixedExtension: false,
    format: "esm",
    target: "node20",
  },
});
