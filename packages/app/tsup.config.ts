import { createRequire } from "node:module";

import { defineConfig } from "tsup";
import { z } from "zod";

const require = createRequire(import.meta.url);
const preactPackageJson = z
  .object({ version: z.string() })
  .parse(require("preact/package.json"));

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
