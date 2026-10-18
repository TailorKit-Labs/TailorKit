import {
  contextErrorResponse,
  createContext,
} from "@tailorkit/api-platform/context";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
  withSpan,
} from "@tailorkit/observability";

import { createApiEntry } from "./entry";

export const handleMcpRequest = async ({ request }: { request: Request }) => {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "mcp",
    "tailorkit.package": "apps-web",
  });

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript may reject with arbitrary values; this boundary records or preserves the original failure.
  const context = await createContext({ request }).catch((error: unknown) => {
    recordException(error, { "tailorkit.adapter": "mcp" });
    console.error("MCP authorization failed", sanitizeErrorForLog(error));
    // oxlint-disable-next-line typescript/only-throw-error -- Preserve the existing HTTP authorization response at the framework boundary.
    throw contextErrorResponse(error);
  });

  const { handleAppAgentMcpRequest } = await withSpan(
    "mcp.load_handler",
    async () => await import("@tailorkit/api-platform/app-agent-mcp")
  );
  return await withSpan(
    "mcp.dispatch",
    {
      attributes: {
        "mcp.method.name": request.headers.get("mcp-method") ?? undefined,
      },
    },
    async () => await handleAppAgentMcpRequest(request, context)
  );
};

export default createApiEntry(handleMcpRequest, [
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
]);
