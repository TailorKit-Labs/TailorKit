import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { os } from "@orpc/server";
import { expect, it, vi } from "vite-plus/test";

import type { Context } from "./context";

const calls = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@tailorkit/db", () => ({ db: {} }));
vi.mock("./routes/apps.ts", () => ({
  appRouter: { list: os.handler(calls.list) },
}));
vi.mock("@tailorkit/app-agent/workflows", () => ({
  appAgent: vi.fn(),
  deleteSandbox: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("@tailorkit/api-utils/dev-delay", () => ({
  devDelayMiddleware: async ({ next }: { next: () => unknown }) => next(),
}));
vi.mock("@tailorkit/api-utils/rate-limiting", () => ({
  createRateLimiter: vi.fn(),
  ratelimitMiddleware:
    () =>
    async ({ next }: { next: () => unknown }) =>
      next(),
}));
const { handleAppAgentMcpRequest } = await import("./app-agent-mcp");

it("connects an ordinary MCP client directly to the platform with standard headers", async () => {
  calls.list.mockResolvedValue({
    body: { items: [], pagination: { hasMore: false } },
  });
  const url = "https://platform.test/api/platform/app-agent/mcp";
  const headers = {
    authorization: "Bearer host-key",
    "x-tailorkit-context": Buffer.from(
      JSON.stringify({
        hostUrl: "https://host.test/api/tailorkit",
        scopes: { org: { tenant: "墨尔本" } },
        subjectId: "user",
      }),
      "utf-8"
    ).toString("base64url"),
  };
  const client = new Client(
    { name: "integration", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        fetch: (input, init) => {
          const request = new Request(input, init);
          expect(request.url).toBe(
            "https://platform.test/api/platform/app-agent/mcp"
          );
          expect(request.headers.get("authorization")).toBe("Bearer host-key");
          return handleAppAgentMcpRequest(request, {
            project: { id: "project" },
            organization: { id: "org" },
          } as Context);
        },
        requestInit: { headers },
      })
    );
    expect(client.getProtocolEra()).toBe("modern");
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      "list_apps",
      "create_app",
      "edit_app",
    ]);
    expect(
      (await client.callTool({ arguments: {}, name: "list_apps" })).isError
    ).not.toBe(true);
    expect(calls.list.mock.lastCall![0].input.body.scopes).toEqual([
      { name: "org", value: { tenant: "墨尔本" } },
    ]);
  } finally {
    await client.close();
  }
});
