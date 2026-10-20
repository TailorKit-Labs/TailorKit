import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: false,
    entry: {
      "primitives-arktype": "src/primitives/arktype.ts",
      "primitives-theme": "src/primitives/theme.ts",
      "primitives-valibot": "src/primitives/valibot.ts",
      "primitives-zod": "src/primitives/zod.ts",
      schema: "src/schema/index.ts",
      server: "src/server/index.ts",
      "server-types": "src/server/types.ts",
      spec: "src/spec/index.ts",
      views: "src/views.ts",
    },
    fixedExtension: false,
    format: "esm",
    target: "node20",
  },
});
