import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: false,
    entry: [
      "src/index.ts",
      "src/server.ts",
      "src/db.ts",
      "src/react.ts",
      "src/client.ts",
      "src/app.ts",
      "src/app-config.ts",
      "src/vite.ts",
      "src/zod.ts",
      "src/valibot.ts",
      "src/arktype.ts",
    ],
    fixedExtension: false,
    format: "esm",
    minify: true,
    target: "node22",
  },
});
