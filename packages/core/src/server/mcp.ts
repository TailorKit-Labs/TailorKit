import { validateTailorKitScopes, type TailorKitScopeSchemas } from "./scope";
import type { TailorKitHostContext, TailorKitPlatformOptions } from "./types";

/** Headers belonging to the MCP exchange, never caller credentials or host identity. */
const mcpHeaders = ["accept", "content-type", "mcp-protocol-version", "mcp-method", "mcp-name"];

async function readMessage(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Response("MCP message too large", { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function createMcpRelay(options: {
  hostUrl: string;
  platformUrl: string;
  platformFetch?: typeof fetch;
  platformHeaders?: TailorKitPlatformOptions["headers"];
  scopeSchemas: TailorKitScopeSchemas;
  schema: () => Record<string, unknown>;
}) {
  return {
    /** Pass the authenticated caller's data; never read scopes from the MCP body. */
    async handler(request: Request, identity: TailorKitHostContext<unknown>): Promise<Response> {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(options.hostUrl).origin)
        return new Response("Forbidden origin", { status: 403 });
      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
      if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        return new Response("Expected application/json", { status: 415 });
      let scopes;
      try {
        if (
          identity.subjectId !== undefined &&
          (typeof identity.subjectId !== "string" ||
            !identity.subjectId ||
            identity.subjectId.length > 256)
        )
          throw new Error("Invalid subject");
        scopes = await validateTailorKitScopes(options.scopeSchemas, identity.scopes);
      } catch {
        return new Response("Invalid MCP identity", { status: 400 });
      }
      let message: unknown;
      try {
        message = await readMessage(request);
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Invalid MCP JSON", { status: 400 });
      }
      const configured = await (typeof options.platformHeaders === "function"
        ? options.platformHeaders()
        : options.platformHeaders);
      const headers = new Headers(configured);
      for (const name of mcpHeaders) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      headers.set("content-type", "application/json");
      const response = await (options.platformFetch ?? globalThis.fetch)(
        options.platformUrl.replace(/\/$/u, "") + "/app-agent/mcp",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            scopes,
            subjectId: identity.subjectId,
            hostUrl: options.hostUrl,
            schema: options.schema(),
            message,
          }),
          signal: request.signal,
        },
      );
      // Preserve the streaming body and its cancellation rather than parsing/buffering it.
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("cache-control", "no-store");
      responseHeaders.set("x-accel-buffering", "no");
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    },
  };
}
