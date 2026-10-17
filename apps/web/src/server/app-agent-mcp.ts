import { handleAppAgentMcpRequest } from "@tailorkit/api-platform/app-agent-mcp";
import {
  contextErrorResponse,
  createContext,
} from "@tailorkit/api-platform/context";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
  withRequestSpan,
} from "@tailorkit/observability";

/** Serve MCP without loading TanStack Start's UI and OpenAPI routers. */
const handle = async ({ req }: { req: Request }): Promise<Response> => {
  await initializeObservability("tailorkit-web");
  return await withRequestSpan(req, "web.request", async (span) => {
    setSpanAttributes({
      "tailorkit.adapter": "mcp",
      "tailorkit.package": "apps-web",
    });
    try {
      const context = await createContext({ request: req });
      const response = await handleAppAgentMcpRequest(req, context);
      span.setAttribute("http.response.status_code", response.status);
      return response;
    } catch (error) {
      recordException(error, { "tailorkit.adapter": "mcp" });
      console.error("MCP request failed", sanitizeErrorForLog(error));
      const response = contextErrorResponse(error);
      span.setAttribute("http.response.status_code", response.status);
      return response;
    }
  });
};

export default handle;
