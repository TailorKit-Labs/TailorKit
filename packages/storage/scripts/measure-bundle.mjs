import nodePath from "node:path";
import { gzipSync } from "node:zlib";

import { build } from "vite-plus";

const root = nodePath.resolve(import.meta.dirname, "..");
const entry = nodePath.resolve(root, "dist/index.mjs");

/** @param {{ code: string }[]} selected Bundled JavaScript chunks. */
const measure = (selected) => ({
  bytes: selected.reduce(
    (size, chunk) => size + Buffer.byteLength(chunk.code),
    0
  ),
  chunks: selected.length,
  gzipBytes: selected.reduce(
    (size, chunk) => size + gzipSync(chunk.code).byteLength,
    0
  ),
});

await build({
  build: {
    minify: true,
    rolldownOptions: {
      external: ["@tailorkit/env", "@tailorkit/observability"],
      output: { codeSplitting: true },
    },
    ssr: entry,
    write: false,
  },
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter(
          (item) => item.type === "chunk"
        );
        const initial = new Set();
        /** @param {string} fileName Output chunk to include in the initial load. */
        const visit = (fileName) => {
          if (initial.has(fileName)) {
            return;
          }
          const chunk = bundle[fileName];
          if (chunk?.type !== "chunk") {
            return;
          }
          initial.add(fileName);
          for (const dependency of chunk.imports) {
            visit(dependency);
          }
        };
        for (const chunk of chunks) {
          if (chunk.isEntry) {
            visit(chunk.fileName);
          }
        }
        console.log(
          JSON.stringify(
            {
              initial: measure(
                chunks.filter((chunk) => initial.has(chunk.fileName))
              ),
              total: measure(chunks),
            },
            null,
            2
          )
        );
      },
      name: "measure-storage-bundle",
    },
  ],
  root,
  ssr: { noExternal: true },
});
