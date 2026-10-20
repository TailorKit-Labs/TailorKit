import { patchsmith } from "patchsmith/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [patchsmith()]),
});
