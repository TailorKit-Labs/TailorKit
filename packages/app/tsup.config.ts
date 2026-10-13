import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);
const preactPackageJson = require("preact/package.json") as { version: string };

export default defineConfig({
  clean: true,
  define: {
    __PREACT_VERSION__: JSON.stringify(preactPackageJson.version),
  },
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    "client-connection": "src/client/connection.ts",
    server: "src/server.ts",
    protocol: "src/protocol.ts",
  },
  format: ["esm"],
  target: "node20",
});
