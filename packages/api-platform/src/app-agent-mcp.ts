import { createAppAgentMcp } from "@tailorkit/agent/mcp";
import { z } from "zod";

import type { Context } from "./context";
import { canonicalizeScopes, scopeValueSchema } from "./scope";

const contextSchema = z.strictObject({
  hostUrl: z.url({ protocol: /^https?$/u }),
  scopes: z.record(z.string(), scopeValueSchema),
  subjectId: z.string().min(1).max(256).optional(),
});

export type AppAgentMcpCaller = z.infer<typeof contextSchema>;

/** Standard MCP endpoint. Host project keys authenticate caller context carried in headers. */
export const handleAppAgentMcpRequest = async (
  request: Request,
  context: Context
): Promise<Response> => {
  if (context.runtimeService === true || context.agentToken) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      headers: { allow: "POST" },
      status: 405,
    });
  }
  let input: z.infer<typeof contextSchema>;
  let scopes: ReturnType<typeof canonicalizeScopes>;
  try {
    const encoded = request.headers.get("x-tailorkit-context");
    if (
      !(encoded !== undefined && encoded !== null && encoded !== "") ||
      encoded.length > 8192 ||
      !/^[A-Za-z0-9_-]+$/u.test(encoded)
    ) {
      throw new Error("Invalid MCP context header");
    }
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      throw new Error("Invalid MCP context encoding");
    }
    input = contextSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    );
    scopes = canonicalizeScopes(
      Object.entries(input.scopes).map(([name, value]) => ({ name, value }))
    );
    const host = new URL(input.hostUrl);
    if (host.username || host.password || host.search || host.hash) {
      throw new Error("Invalid host URL");
    }
    const origin = request.headers.get("origin");
    if (
      origin !== undefined &&
      origin !== null &&
      origin !== "" &&
      origin !== host.origin
    ) {
      return new Response("Forbidden origin", { status: 403 });
    }
  } catch {
    return new Response("Invalid MCP context header", { status: 400 });
  }
  const backend = async () => {
    const { createAppAgentMcpBackend } =
      await import("./app-agent-mcp-backend");
    return createAppAgentMcpBackend(context, input, scopes);
  };
  const handler = createAppAgentMcp(
    {
      createApp: async (...args) => {
        const operations = await backend();
        return await operations.createApp(...args);
      },
      editApp: async (...args) => {
        const operations = await backend();
        return await operations.editApp(...args);
      },
      listApps: async (...args) => {
        const operations = await backend();
        return await operations.listApps(...args);
      },
    },
    scopes.map(({ scope }) => scope.name)
  );
  const response = await handler.fetch(request);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-accel-buffering", "no");
  return response;
};
