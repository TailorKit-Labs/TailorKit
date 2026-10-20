import { readFile } from "node:fs/promises";

import { tailorkit } from "tailorkit/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [
    {
      load: async (id: string) => {
        if (id !== "\0virtual:doomgeneric") {
          return null;
        }
        try {
          return await readFile(
            new URL(".cache/doomgeneric/runtime.mjs", import.meta.url),
            "utf-8"
          );
        } catch {
          return 'export const wadBase64 = ""; export default async function () { throw new Error("Run pnpm --filter @playground/todo build:doom, then rebuild the Todo app."); }';
        }
      },
      name: "doomgeneric-demo",
      resolveId: (id: string) =>
        id === "virtual:doomgeneric" ? "\0virtual:doomgeneric" : null,
    },
    tailorkit(),
  ]),
});
