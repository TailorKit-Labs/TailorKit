import { createFileRoute } from "@tanstack/react-router";

import { handleAuthRequest } from "#server/api/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handleAuthRequest,
      POST: handleAuthRequest,
    },
  },
});
