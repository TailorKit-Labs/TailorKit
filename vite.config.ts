import { defineConfig } from "vite-plus";

import formatting from "./oxfmt.config";

export default defineConfig({
  fmt: formatting,
  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": "vp check --fix",
    "*.{json,jsonc,json5,md,mdx,yaml,yml,css,html}": "vp fmt",
  },
});
