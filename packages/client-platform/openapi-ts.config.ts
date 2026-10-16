import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../api-platform/openapi.json",
  output: {
    clean: true,
    module: {
      extension: ".js",
    },
    path: "src/client",
  },
  plugins: [
    "@hey-api/typescript",
    {
      auth: true,
      name: "@hey-api/sdk",
    },
  ],
});
