import { defineConfig } from "vite-plus";

import packageJson from "./package.json" with { type: "json" };

const liquidRawPlugin = () => ({
  name: "liquid-raw",
  transform: (code: string, id: string) =>
    id.endsWith(".liquid")
      ? `export default ${JSON.stringify(code)};`
      : undefined,
});

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: "dist",
    rollupOptions: {
      external: [
        /^node:/u,
        /^@patchsmith\/vite(?:\/|$)/u,
        "@clack/prompts",
        "@ai-sdk/tui",
        "@standard-schema/spec",
        "arktype",
        "cac",
        "liquidjs",
        "picocolors",
        "preact",
        "preact/hooks",
        "preact/package.json",
        "valibot",
        "vite",
        "zod",
      ],
      output: {
        banner:
          'import { fileURLToPath as __patchsmithFileURLToPath } from "node:url";\nimport { dirname as __patchsmithDirname } from "node:path";\nconst __filename = __patchsmithFileURLToPath(import.meta.url);\nconst __dirname = __patchsmithDirname(__filename);',
        entryFileNames: "index.js",
      },
    },
    ssr: "src/index.ts",
    target: "node22",
  },
  define: {
    __PATCHSMITH_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [liquidRawPlugin()],
});
