import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "happy-dom",
    hookTimeout: 5000,
    testTimeout: 5000,
  },
});
