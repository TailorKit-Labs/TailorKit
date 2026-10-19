import { appAgentMcpDiscovery } from "@patchsmith/agent/mcp";

export const handleMcpRequest = async ({ request }: { request: Request }) => {
  if (
    request.method === "POST" &&
    request.headers.get("mcp-method") === "server/discover"
  ) {
    // The SDK validates the body method against this header. A forged header
    // cannot dispatch tools through the public advertisement handler.
    const response = await appAgentMcpDiscovery.fetch(request);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  // Discovery must not load auth, storage, telemetry, or workflow startup code.
  const { default: authenticated } = await import("./mcp-authenticated");
  return await authenticated.fetch(request);
};

export default {
  fetch: async (request: Request) => await handleMcpRequest({ request }),
};
