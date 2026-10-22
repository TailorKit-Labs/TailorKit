import { readFile } from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    viteReact(),
    {
      name: "local-canvas-demo-client",
      configureServer: (server) => {
        server.middlewares.use("/canvas-client.js", (_request, response) => {
          void (async () => {
            try {
              const source = await readFile(
                new URL(
                  "../apps/todo/.patchsmith/client/client.js",
                  import.meta.url
                )
              );

              response.setHeader("Content-Type", "application/javascript");
              response.end(source);
            } catch {
              response.statusCode = 503;
              response.end(
                "Build the playground Todo app before opening the canvas demo."
              );
            }
          })();
        });
      },
    },
  ],
});
