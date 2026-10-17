import {
  createContext,
  contextErrorResponse,
} from "@tailorkit/api-platform/context";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
} from "@tailorkit/observability";
import { createFileRoute } from "@tanstack/react-router";

const createOpenAPIHandler = async () => {
  const [
    { OpenAPIHandler },
    { onError },
    { platformRouter },
    { RateLimitHandlerPlugin },
  ] = await Promise.all([
    import("@orpc/openapi/fetch"),
    import("@orpc/server"),
    import("@tailorkit/api-platform"),
    import("@tailorkit/api-utils/rate-limiting"),
  ]);
  return new OpenAPIHandler(platformRouter, {
    interceptors: [
      onError((failure) => {
        recordException(failure, { "tailorkit.adapter": "orpc-openapi" });
        console.error("OpenAPI request failed", sanitizeErrorForLog(failure));
      }),
    ],
    plugins: [new RateLimitHandlerPlugin()],
  });
};

let openAPIHandler: ReturnType<typeof createOpenAPIHandler> | undefined;

const handle = async ({ request }: { request: Request }) => {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "orpc-openapi",
    "tailorkit.package": "apps-web",
  });

  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/api/platform/runtime/keys") {
    const { appRuntimeKeysResponse } =
      await import("@tailorkit/api-platform/routes/runtime");
    return appRuntimeKeysResponse();
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript may reject with arbitrary values; this boundary records or preserves the original failure.
  const context = await createContext({ request }).catch((error: unknown) => {
    recordException(error, { "tailorkit.adapter": "orpc-openapi" });
    console.error("OpenAPI authorization failed", sanitizeErrorForLog(error));
    // oxlint-disable-next-line typescript/only-throw-error -- Preserve the transport failure object, including its code and metadata, for the existing downstream error mapping.
    throw contextErrorResponse(error);
  });

  const handler = await (openAPIHandler ??= createOpenAPIHandler());
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
