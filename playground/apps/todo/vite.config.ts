import { defineConfig, lazyPlugins } from "vite-plus";
import { tailorkit } from "tailorkit/vite";

export default defineConfig({
  plugins: lazyPlugins(() => [tailorkit()]),
});
