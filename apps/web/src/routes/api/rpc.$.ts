import { createFileRoute } from "@tanstack/react-router";

import { handleRpcRequest } from "#server/api/rpc";

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      DELETE: handleRpcRequest,
      GET: handleRpcRequest,
      HEAD: handleRpcRequest,
      PATCH: handleRpcRequest,
      POST: handleRpcRequest,
      PUT: handleRpcRequest,
    },
  },
});
