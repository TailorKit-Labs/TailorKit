import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: false,
    entry: ["src/index.ts"],
    fixedExtension: false,
    format: "esm",
    target: "node22",
  },
});
