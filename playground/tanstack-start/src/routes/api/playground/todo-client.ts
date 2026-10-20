import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createFileRoute } from "@tanstack/react-router";

const clientPath = fileURLToPath(
  new URL(
    "../../../../../apps/todo/.patchsmith/client/client.js",
    import.meta.url
  )
);

export const Route = createFileRoute("/api/playground/todo-client")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const client = await readFile(clientPath);

          return new Response(client, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/javascript; charset=utf-8",
            },
          });
        } catch {
          return new Response("Build the local Todo app before opening it.", {
            status: 503,
          });
        }
      },
    },
  },
});
