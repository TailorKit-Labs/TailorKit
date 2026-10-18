import { createFileRoute } from "@tanstack/react-router";

import { handlePlatformRequest } from "#server/api/platform";

export const Route = createFileRoute("/api/platform/$")({
  server: {
    handlers: {
      DELETE: handlePlatformRequest,
      GET: handlePlatformRequest,
      HEAD: handlePlatformRequest,
      PATCH: handlePlatformRequest,
      POST: handlePlatformRequest,
      PUT: handlePlatformRequest,
    },
  },
});
