import { createFileRoute } from "@tanstack/react-router";

import { handleAssetsRequest } from "#server/api/assets";

export const Route = createFileRoute("/api/assets/$")({
  server: {
    handlers: {
      DELETE: handleAssetsRequest,
      GET: handleAssetsRequest,
      HEAD: handleAssetsRequest,
      OPTIONS: handleAssetsRequest,
      PATCH: handleAssetsRequest,
      POST: handleAssetsRequest,
      PUT: handleAssetsRequest,
    },
  },
});
