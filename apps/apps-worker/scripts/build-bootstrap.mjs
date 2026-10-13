import { mkdir, readFile, writeFile } from "node:fs/promises";

import { build } from "vite";

await build({
  build: {
    outDir: ".generated",
    rollupOptions: {
      external: ["cloudflare:workers", "node:async_hooks", "application.js"],
      output: { entryFileNames: "bootstrap.js" },
    },
    ssr: "src/dynamic-workers/facet.ts",
    target: "es2022",
  },
  configFile: false,
  logLevel: "error",
  ssr: { noExternal: true, target: "webworker" },
});
await mkdir(".generated", { recursive: true });
await writeFile(
  ".generated/bootstrap.txt",
  await readFile(".generated/bootstrap.js")
);
