import { describe, expect, it } from "vite-plus/test";

import entry from "./mcp";

const discoveryRequest = (method = "server/discover", version = "2026-07-28") =>
  new Request("https://platform.test/api/platform/app-agent/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: {
        arguments: method === "tools/call" ? {} : undefined,
        name: method === "tools/call" ? "list_apps" : undefined,
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/protocolVersion": version,
        },
      },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": "server/discover",
      "mcp-protocol-version": version,
    },
    method: "POST",
  });

describe("public MCP discovery", () => {
  it("advertises the current protocol without credentials or host context", async () => {
    const response = await entry.fetch(discoveryRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      id: 1,
      jsonrpc: "2.0",
      result: {
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "tailorkit-app-agent",
            version: "1.0.0",
          },
        },
        capabilities: { tools: { listChanged: true } },
        supportedVersions: ["2026-07-28"],
      },
    });
  });

  it.each(["tools/list", "tools/call", "subscriptions/listen", "initialize"])(
    "rejects a forged discovery header on %s",
    async (method) => {
      const response = await entry.fetch(discoveryRequest(method));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: -32_020 },
      });
    }
  );

  it("preserves SDK rejection of unsupported protocol versions", async () => {
    const response = await entry.fetch(
      discoveryRequest("server/discover", "2099-01-01")
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: -32_022 },
    });
  });
});
