import { copyFile } from "node:fs/promises";

import { build } from "vite";

// The loader needs the isolated facet as source text, separate from the trusted worker.
await build({
  build: {
    outDir: ".generated",
    rolldownOptions: {
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

await copyFile(".generated/bootstrap.js", ".generated/bootstrap.txt");
