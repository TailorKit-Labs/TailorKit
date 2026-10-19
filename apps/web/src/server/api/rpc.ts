import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RateLimitHandlerPlugin } from "@patchsmith/api-utils/rate-limiting";
import { createContext } from "@patchsmith/api/context";
import { appRouter } from "@patchsmith/api/routers/index";
import {
  initializeObservability,
  recordException,
  sanitizeErrorForLog,
  setSpanAttributes,
} from "@patchsmith/observability";

import { createApiEntry } from "./entry";

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The oRPC error interceptor is a synchronous callback required by the adapter API.
    onError((err) => {
      recordException(err, { "patchsmith.adapter": "orpc-rpc" });
      console.error("oRPC request failed", sanitizeErrorForLog(err));
    }),
  ],
  plugins: [new RateLimitHandlerPlugin()],
});

export const handleRpcRequest = async ({ request }: { request: Request }) => {
  await initializeObservability("patchsmith-web");
  setSpanAttributes({
    "patchsmith.adapter": "orpc-rpc",
    "patchsmith.package": "apps-web",
  });

  const rpcResult = await rpcHandler.handle(request, {
    context: await createContext({ request }),
    prefix: "/api/rpc",
  });
  if (rpcResult.response) {
    return rpcResult.response;
  }

  return new Response("Not found", { status: 404 });
};

export default createApiEntry(handleRpcRequest, [
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
]);
