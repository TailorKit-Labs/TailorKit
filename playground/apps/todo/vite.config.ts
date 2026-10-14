import { tailorkit } from "tailorkit/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [tailorkit()]),
});
