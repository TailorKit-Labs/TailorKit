import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { createTailorKitServer } from "./handler";

const message = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const identity = { scopes: { org: { tenant: "one" } }, subjectId: "user-one" };

function setup() {
  const requests: Request[] = [];
  const cancel = vi.fn();
  const server = createTailorKitServer({
    baseUrl: "https://host.test/api/tailorkit",
    projectKey: "host-key",
    scopes: { org: z.object({ tenant: z.string().min(1) }) },
    components: {},
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform",
      platformFetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: progress\n\n"));
            },
            cancel,
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    },
  });
  return { server, requests, cancel };
}

function request(headers: Record<string, string> = {}, body: unknown = message) {
  return new Request("https://host.test/api/tailorkit/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("host MCP relay", () => {
  it("offers a typed API taking authenticate's result and streams without buffering", async () => {
    const { server, requests, cancel } = setup();
    const response = await server.mcp.handler(
      request({ authorization: "Bearer caller-secret" }),
      identity,
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: progress\n\n");
    await reader.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(requests[0]!.url).toBe("https://platform.test/api/platform/app-agent/mcp");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer host-key");
    expect(requests[0]!.headers.get("mcp-method")).toBe("tools/list");
    expect(await requests[0]!.json()).toEqual({
      ...identity,
      hostUrl: "https://host.test/api/tailorkit",
      schema: server.$internal.schema.serialize(),
      message,
    });
  });

  it("authenticates the /mcp route and ignores identity supplied in the request body", async () => {
    const { server, requests } = setup();
    const authenticate = vi.fn(() => identity);
    const response = await server.handler(
      request({}, { ...message, scopes: { org: { tenant: "other" } } }),
      { authenticate },
    );
    await response.body!.cancel();
    expect(authenticate).toHaveBeenCalledOnce();
    expect(await requests[0]!.json()).toMatchObject(identity);
    expect((await server.handler(request(), { authenticate: () => null })).status).toBe(401);
    expect(requests).toHaveLength(1);
  });

  it("rejects undeclared/invalid scopes and subjects before forwarding", async () => {
    const { server, requests } = setup();
    for (const invalid of [
      { scopes: {} },
      { scopes: { other: { tenant: "one" } } },
      { scopes: { org: { tenant: "" } } },
      { ...identity, subjectId: "" },
      { ...identity, subjectId: "x".repeat(257) },
    ]) {
      expect((await server.mcp.handler(request(), invalid as typeof identity)).status).toBe(400);
    }
    expect(requests).toHaveLength(0);
  });

  it("rejects cross-origin and legacy GET stream requests", async () => {
    const { server, requests } = setup();
    expect(
      (await server.mcp.handler(request({ origin: "https://other.test" }), identity)).status,
    ).toBe(403);
    expect(
      (await server.mcp.handler(new Request("https://host.test/api/tailorkit/mcp"), identity))
        .status,
    ).toBe(405);
    expect(requests).toHaveLength(0);
  });

  it("bounds message bodies and preserves subject-free identities", async () => {
    const { server, requests } = setup();
    expect(
      (await server.mcp.handler(request({ "content-type": "text/plain" }), identity)).status,
    ).toBe(415);
    expect(
      (await server.mcp.handler(request({}, { data: "x".repeat(4 * 1024 * 1024) }), identity))
        .status,
    ).toBe(413);
    const response = await server.mcp.handler(request(), { scopes: identity.scopes });
    await response.body!.cancel();
    expect(await requests[0]!.json()).not.toHaveProperty("subjectId");
  });
});
