import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createAppAgentMcp } from "./mcp";
import type { AppAgentMcpBackend } from "./mcp";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close();
  }
});

async function connect(overrides: Partial<AppAgentMcpBackend> = {}) {
  const backend = {
    createApp: vi.fn(async () => ({ appId: "new-app" })),
    editApp: vi.fn(async () => ({ appId: "existing-app" })),
    listApps: vi.fn(async () => ({
      items: [],
      pagination: { hasMore: false },
    })),
    ...overrides,
  };
  const handler = createAppAgentMcp(backend, ["org"]);
  cleanup.push(() => handler.close());
  const client = new Client(
    { name: "test", version: "1" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    }
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
    })
  );
  return { backend, client, handler, requests };
}

describe("app agent MCP", () => {
  it("discovers only three tools over the current protocol and explains agent creation", async () => {
    const { client, backend } = await connect();
    expect(client.getProtocolEra()).toBe("modern");
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "list_apps",
      "create_app",
      "edit_app",
    ]);
    expect(
      tools.find(({ name }) => name === "create_app")?.inputSchema.properties
        ?.scope
    ).toMatchObject({ enum: ["org"] });
    for (const name of ["create_app", "edit_app"]) {
      expect(tools.find((tool) => tool.name === name)?.description).toMatch(
        /create an autonomous app agent/iu
      );
    }
    await client.callTool({ arguments: {}, name: "list_apps" });
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
          chunk: { delta: "Building", type: "text-delta" },
          runId: "run",
        });
        await progressReceived;
        return { appId: "app", messages: [], runId: "run" };
      },
    });
    const result = await client.callTool(
      { arguments: { appId: "app", prompt: "Change it" }, name: "edit_app" },
      {
        onprogress: (progress) => {
          events.push(JSON.parse(progress.message!));
          received();
        },
      }
    );
    expect(result.isError).not.toBe(true);
    expect(events).toEqual([
      { chunk: { delta: "Building", type: "text-delta" }, runId: "run" },
    ]);
    expect(result.structuredContent).toMatchObject({
      appId: "app",
      runId: "run",
    });
  });

  it("rejects legacy initialization and mismatched metadata headers", async () => {
    const { handler, requests } = await connect();
    const legacy = await handler.fetch(
      new Request("https://host.test/mcp", {
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
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    expect(legacy.status).toBe(400);
    const valid = requests[0]!;
    const headers = new Headers(valid.headers);
    headers.set("mcp-method", "tools/call");
    const mismatch = await handler.fetch(
      new Request(valid.url, {
        body: await valid.text(),
        headers,
        method: "POST",
      })
    );
    expect(mismatch.status).toBe(400);
  });

  it("rejects identity injection in tool arguments before touching the backend", async () => {
    const { client, backend } = await connect();
    const result = await client.callTool({
      arguments: {
        appId: "app",
        prompt: "Change",
        scopes: { org: { tenant: "other" } },
      },
      name: "edit_app",
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
            { once: true }
          )
        );
        return {};
      },
    });
    const controller = new AbortController();
    const call = client.callTool(
      { arguments: { appId: "app", prompt: "Change" }, name: "edit_app" },
      {
        onprogress: () => controller.abort(),
        signal: controller.signal,
      }
    );
    await expect(call).rejects.toThrow();
    await cancellation;
  });
});
