import preactPackageJson from "preact/package.json" with { type: "json" };
import { defineConfig } from "tsup";

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
