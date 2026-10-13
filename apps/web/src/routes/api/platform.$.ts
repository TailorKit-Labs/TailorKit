import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { platformRouter } from "@tailorkit/api-platform";
import { handleAppAgentMcpRequest } from "@tailorkit/api-platform/app-agent-mcp";
import {
  createContext,
  contextErrorResponse,
} from "@tailorkit/api-platform/context";
import { handlePublicRuntimeRequest } from "@tailorkit/api-platform/routes/runtime";
import { RateLimitHandlerPlugin } from "@tailorkit/api-utils/rate-limiting";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
} from "@tailorkit/observability";
import { createFileRoute } from "@tanstack/react-router";

const handler = new OpenAPIHandler(platformRouter, {
  interceptors: [
    onError((error) => {
      recordException(error, { "tailorkit.adapter": "orpc-openapi" });
      console.error("OpenAPI request failed", sanitizeErrorForLog(error));
    }),
  ],
  plugins: [new RateLimitHandlerPlugin()],
});

async function handle({ request }: { request: Request }) {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-openapi",
    "tailorkit.package": "apps-web",
  });

  const publicResponse = handlePublicRuntimeRequest(request);
  if (publicResponse) {
    return publicResponse;
  }

  const context = await createContext({ request }).catch((error) => {
    recordException(error, { "tailorkit.adapter": "orpc-openapi" });
    console.error("OpenAPI authorization failed", sanitizeErrorForLog(error));
    throw contextErrorResponse(error);
  });

  if (new URL(request.url).pathname === "/api/platform/app-agent/mcp") {
    return handleAppAgentMcpRequest(request, context);
  }

  const rpcResult = await handler.handle(request, {
    context,
    prefix: "/api/platform",
  });

  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/api/platform/$")({
  server: {
    handlers: {
      DELETE: handle,
      GET: handle,
      HEAD: handle,
      PATCH: handle,
      POST: handle,
      PUT: handle,
    },
  },
});
