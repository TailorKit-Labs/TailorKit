import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAppAgentMcp, type AppAgentMcpBackend } from "./mcp";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function connect(overrides: Partial<AppAgentMcpBackend> = {}) {
  const backend = {
    listApps: vi.fn(async () => ({ items: [], pagination: { hasMore: false } })),
    createApp: vi.fn(async () => ({ appId: "new-app" })),
    editApp: vi.fn(async () => ({ appId: "existing-app" })),
    ...overrides,
  };
  const handler = createAppAgentMcp(backend, ["org"]);
  cleanup.push(() => handler.close());
  const client = new Client(
    { name: "test", version: "1" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  cleanup.push(() => client.close());
  const requests: Request[] = [];
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://host.test/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return handler.fetch(request);
      },
    }),
  );
  return { client, backend, handler, requests };
}

describe("app agent MCP", () => {
  it("discovers only three tools over the current protocol and explains agent creation", async () => {
    const { client, backend } = await connect();
    expect(client.getProtocolEra()).toBe("modern");
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(["list_apps", "create_app", "edit_app"]);
    expect(
      tools.find(({ name }) => name === "create_app")?.inputSchema.properties?.scope,
    ).toMatchObject({ enum: ["org"] });
    for (const name of ["create_app", "edit_app"]) {
      expect(tools.find((tool) => tool.name === name)?.description).toMatch(
        /create an autonomous app agent/iu,
      );
    }
    await client.callTool({ name: "list_apps", arguments: {} });
    expect(backend.listApps).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it("streams progress before the final agent result", async () => {
    const events: unknown[] = [];
    let received!: () => void;
    const progressReceived = new Promise<void>((resolve) => {
      received = resolve;
    });
    const { client } = await connect({
      async editApp(input, execution) {
        expect(input).toEqual({ appId: "app", prompt: "Change it" });
        await execution.onProgress({
          runId: "run",
          chunk: { type: "text-delta", delta: "Building" },
        });
        await progressReceived;
        return { appId: "app", runId: "run", messages: [] };
      },
    });
    const result = await client.callTool(
      { name: "edit_app", arguments: { appId: "app", prompt: "Change it" } },
      {
        onprogress: (progress) => {
          events.push(JSON.parse(progress.message!));
          received();
        },
      },
    );
    expect(result.isError).not.toBe(true);
    expect(events).toEqual([{ runId: "run", chunk: { type: "text-delta", delta: "Building" } }]);
    expect(result.structuredContent).toMatchObject({ appId: "app", runId: "run" });
  });

  it("rejects legacy initialization and mismatched metadata headers", async () => {
    const { handler, requests } = await connect();
    const legacy = await handler.fetch(
      new Request("https://host.test/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            clientInfo: { name: "old", version: "1" },
            capabilities: {},
          },
        }),
      }),
    );
    expect(legacy.status).toBe(400);
    const valid = requests[0]!;
    const headers = new Headers(valid.headers);
    headers.set("mcp-method", "tools/call");
    const mismatch = await handler.fetch(
      new Request(valid.url, { method: "POST", headers, body: await valid.text() }),
    );
    expect(mismatch.status).toBe(400);
  });

  it("rejects identity injection in tool arguments before touching the backend", async () => {
    const { client, backend } = await connect();
    const result = await client.callTool({
      name: "edit_app",
      arguments: {
        appId: "app",
        prompt: "Change",
        scopes: { org: { tenant: "other" } },
      },
    });
    expect(result.isError).toBe(true);
    expect(backend.editApp).not.toHaveBeenCalled();
  });

  it("propagates response cancellation to the running tool", async () => {
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const { client } = await connect({
      async editApp(_input, execution) {
        await execution.onProgress({ status: "started" });
        await new Promise<void>((resolve) =>
          execution.signal.addEventListener(
            "abort",
            () => {
              cancelled();
              resolve();
            },
            { once: true },
          ),
        );
        return {};
      },
    });
    const controller = new AbortController();
    const call = client.callTool(
      { name: "edit_app", arguments: { appId: "app", prompt: "Change" } },
      {
        signal: controller.signal,
        onprogress: () => controller.abort(),
      },
    );
    await expect(call).rejects.toThrow();
    await cancellation;
  });
});
