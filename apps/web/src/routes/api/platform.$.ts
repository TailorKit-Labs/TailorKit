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
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The oRPC error interceptor is a synchronous callback required by the adapter API.
    onError((err) => {
      recordException(err, { "tailorkit.adapter": "orpc-openapi" });
      console.error("OpenAPI request failed", sanitizeErrorForLog(err));
    }),
  ],
  plugins: [new RateLimitHandlerPlugin()],
});

const handle = async ({ request }: { request: Request }) => {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-openapi",
    "tailorkit.package": "apps-web",
  });

  const publicResponse = handlePublicRuntimeRequest(request);
  if (publicResponse) {
    return publicResponse;
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript may reject with arbitrary values; this boundary records or preserves the original failure.
  const context = await createContext({ request }).catch((error: unknown) => {
    recordException(error, { "tailorkit.adapter": "orpc-openapi" });
    console.error("OpenAPI authorization failed", sanitizeErrorForLog(error));
    // oxlint-disable-next-line typescript/only-throw-error -- Preserve the transport failure object, including its code and metadata, for the existing downstream error mapping.
    throw contextErrorResponse(error);
  });

  if (new URL(request.url).pathname === "/api/platform/app-agent/mcp") {
    return await handleAppAgentMcpRequest(request, context);
  }

  const rpcResult = await handler.handle(request, {
    context,
    prefix: "/api/platform",
  });

  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
};

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
