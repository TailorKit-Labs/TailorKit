import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "#server/api/mcp";

export const Route = createFileRoute("/api/platform/app-agent/mcp")({
  server: {
    handlers: {
      DELETE: handleMcpRequest,
      GET: handleMcpRequest,
      HEAD: handleMcpRequest,
      PATCH: handleMcpRequest,
      POST: handleMcpRequest,
      PUT: handleMcpRequest,
    },
  },
});
