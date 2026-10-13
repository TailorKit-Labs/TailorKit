import { createRequire } from "node:module";

import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);
// SAFETY: Node resolves the installed Preact package manifest; its version string determines the bundled compatibility version.
const preactPackageJson = require("preact/package.json") as { version: string };

export default defineConfig({
  clean: true,
  define: {
    __PREACT_VERSION__: JSON.stringify(preactPackageJson.version),
  },
  entry: {
    client: "src/client.ts",
    "client-connection": "src/client/connection.ts",
    index: "src/index.ts",
    protocol: "src/protocol.ts",
    server: "src/server.ts",
  },
  format: ["esm"],
  target: "node20",
});
