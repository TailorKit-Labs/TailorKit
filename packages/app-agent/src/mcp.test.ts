import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleAppAgentMcpRequest, type AgentRun, type AppAgentMcpBackend } from "./mcp";

const hostUrl = "https://host.test/api/tailorkit";
const app = { id: "app-one", name: "Notes", description: "A notes app" };
const clients: Client[] = [];
const backend = {
  listApps: vi.fn<AppAgentMcpBackend["listApps"]>(),
  createApp: vi.fn<AppAgentMcpBackend["createApp"]>(),
  findApp: vi.fn<AppAgentMcpBackend["findApp"]>(),
  startRun: vi.fn<AppAgentMcpBackend["startRun"]>(),
  getRun: vi.fn<AppAgentMcpBackend["getRun"]>(),
};

function run(parts: ModelCallStreamPart[], status = "completed") {
  const cancel = vi.fn();
  const output = vi.fn(async () => ({
    messages: [{ role: "assistant" as const, content: "Built the notes page. Checks passed." }],
  }));
  const state = { status };
  const value: AgentRun = {
    runId: "run-one",
    get status() {
      return Promise.resolve(state.status);
    },
    get returnValue() {
      return output();
    },
    getReadable({ startIndex }) {
      const stream = new ReadableStream<ModelCallStreamPart>({
        start(controller) {
          for (const part of parts.slice(startIndex)) controller.enqueue(part);
          // Leave open to cover failures before the workflow opens/closes its writable.
        },
        cancel,
      });
      return Object.assign(stream, { getTailIndex: async () => parts.length - 1 });
    },
  };
  return { value, cancel, output, state };
}

async function connect() {
  const client = new Client({ name: "calling-agent", version: "1.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://platform.test/api/platform/app-agent/mcp"), {
      fetch: async (url, init) => handleAppAgentMcpRequest(new Request(url, init), backend),
    }),
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.findApp.mockResolvedValue(app);
  backend.createApp.mockResolvedValue(app);
  backend.listApps.mockResolvedValue({
    items: [app],
    pagination: { page: 1, pageSize: 20, hasMore: false },
  });
  backend.startRun.mockResolvedValue(run([]).value);
  backend.getRun.mockResolvedValue(run([]).value);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("app-agent MCP over Streamable HTTP", () => {
  it("discovers the delegation instructions and tools through a real MCP client", async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain("separate app-building sub-agent");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_apps",
      "create_app",
      "edit_app",
      "get_app_run",
    ]);
    for (const tool of tools.filter((tool) => ["create_app", "edit_app"].includes(tool.name))) {
      expect(tool.description).toContain("NEW app-building sub-agent");
      expect(tool.annotations?.readOnlyHint).toBe(false);
    }
    const result = await client.callTool({ name: "list_apps", arguments: {} });
    expect(result.structuredContent).toMatchObject({ items: [app] });
    expect(backend.listApps).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(backend.startRun).not.toHaveBeenCalled();
  });

  it("creates an app and streams text and tool progress before the final sub-agent result", async () => {
    const workflow = run([
      { type: "text-delta", id: "text-1", text: "Building notes" },
      { type: "tool-call", toolName: "write", toolCallId: "call-1", input: { path: "index.ts" } },
      {
        type: "tool-result",
        toolName: "write",
        toolCallId: "call-1",
        input: {},
        output: { success: true },
      },
    ]);
    backend.startRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const progress: Progress[] = [];
    const result = await client.callTool(
      {
        name: "create_app",
        arguments: {
          name: "Notes",
          prompt: "Build a notes page",
          hostUrl: "https://host.test/api/tailorkit",
          schema: { components: {} },
        },
      },
      undefined,
      {
        onprogress: (event) => {
          progress.push(event);
        },
      },
    );
    expect(backend.createApp).toHaveBeenCalledWith({ name: "Notes", description: undefined });
    expect(backend.startRun).toHaveBeenCalledWith("app-one", "Build a notes page", {
      hostUrl,
      schema: { components: {} },
    });
    expect(progress.map((event) => event.progress)).toEqual([0, 1, 2, 3]);
    expect(progress.map((event) => event.message)).toContain("[App sub-agent] Running write");
    expect(result.structuredContent).toMatchObject({
      appId: "app-one",
      runId: "run-one",
      delegation: "sub-agent",
      status: "completed",
      cursor: 3,
      summary: "Built the notes page. Checks passed.",
      published: false,
    });
    expect(workflow.output).toHaveBeenCalledOnce();
    expect(workflow.cancel).toHaveBeenCalledOnce();
  });

  it("returns a resumable active run and observes it without starting another sub-agent", async () => {
    const workflow = run([{ type: "text-delta", id: "text", text: "Working" }], "running");
    backend.startRun.mockResolvedValue(workflow.value);
    backend.getRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const initial = await client.callTool({
      name: "edit_app",
      arguments: { appId: "public-alias", prompt: "Add a page", hostUrl, waitSeconds: 0 },
    });
    expect(backend.startRun).toHaveBeenCalledWith("app-one", "Add a page", {
      hostUrl,
      schema: undefined,
    });
    expect(initial.structuredContent).toMatchObject({
      status: "running",
      cursor: 1,
      runId: "run-one",
    });
    expect(workflow.output).not.toHaveBeenCalled();
    workflow.state.status = "completed";
    const final = await client.callTool({
      name: "get_app_run",
      arguments: { appId: "app-one", runId: "run-one", cursor: 1 },
    });
    expect(backend.getRun).toHaveBeenCalledWith("app-one", "run-one");
    expect(final.structuredContent).toMatchObject({ status: "completed", events: [], cursor: 1 });
    expect(backend.startRun).toHaveBeenCalledOnce();
  });

  it("bounds batches and preserves the cursor even for non-display chunks", async () => {
    const workflow = run(
      Array.from({ length: 205 }, () => ({ type: "reset-step" })),
      "running",
    );
    backend.startRun.mockResolvedValue(workflow.value);
    backend.getRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const first = await client.callTool({
      name: "edit_app",
      arguments: { appId: "app-one", prompt: "Edit", hostUrl, waitSeconds: 0 },
    });
    expect(first.structuredContent).toMatchObject({ cursor: 200, hasMore: true });
    const next = await client.callTool({
      name: "get_app_run",
      arguments: { appId: "app-one", runId: "run-one", cursor: 200, waitSeconds: 0 },
    });
    expect(next.structuredContent).toMatchObject({ cursor: 205, hasMore: false });
  });

  it("identifies model step boundaries, retry resets, and failed tools in progress events", async () => {
    const workflow = run([
      { type: "model-call-start", warnings: [] },
      { type: "text-delta", id: "text", text: "Partial text" },
      { type: "reset-step" },
      {
        type: "tool-error",
        toolName: "bash",
        toolCallId: "call-1",
        input: {},
        error: new Error("Check failed"),
      },
    ]);
    backend.startRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const result = await client.callTool({
      name: "edit_app",
      arguments: { appId: "app-one", prompt: "Edit", hostUrl },
    });
    expect(result.structuredContent).toMatchObject({
      events: [
        { index: 0, type: "step" },
        { index: 1, type: "text" },
        { index: 2, type: "reset" },
        { index: 3, type: "error", message: "bash failed: Check failed", toolCallId: "call-1" },
      ],
    });
  });

  it("reports failure before any model output instead of hanging on the readable", async () => {
    const workflow = run([], "failed");
    workflow.output.mockRejectedValue(new Error("This app is already being edited."));
    backend.startRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const result = await client.callTool({
      name: "edit_app",
      arguments: { appId: "app-one", prompt: "Edit", hostUrl },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      appId: "app-one",
      runId: "run-one",
      status: "failed",
      error: "This app is already being edited.",
    });
    expect(workflow.cancel).toHaveBeenCalledOnce();
  });

  it("preserves the run handle when observing an enqueued sub-agent fails", async () => {
    const workflow = run([], "running");
    vi.spyOn(workflow.value, "status", "get").mockImplementation(() =>
      Promise.reject(new Error("Workflow storage unavailable")),
    );
    backend.startRun.mockResolvedValue(workflow.value);
    const client = await connect();
    const result = await client.callTool({
      name: "edit_app",
      arguments: { appId: "app-one", prompt: "Edit", hostUrl },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      appId: "app-one",
      runId: "run-one",
      status: "unknown",
      error: expect.stringContaining("Retry get_app_run"),
    });
    expect(workflow.cancel).toHaveBeenCalledOnce();
    expect(workflow.output).not.toHaveBeenCalled();
  });

  it("retains the created app identity if enqueueing the sub-agent fails", async () => {
    backend.startRun.mockRejectedValueOnce(new Error("Queue unavailable"));
    const client = await connect();
    const result = await client.callTool({
      name: "create_app",
      arguments: { name: "Notes", prompt: "Build", hostUrl: "https://host.test/api/tailorkit" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      appId: "app-one",
      error: expect.stringContaining("Use edit_app to retry"),
    });
  });

  it("validates new app inputs before creating a record or starting a workflow", async () => {
    const client = await connect();
    for (const argumentsValue of [
      { name: "Notes", prompt: "Build" },
      { name: "  ", prompt: "Build", hostUrl: "https://host.test/api/tailorkit" },
      { name: "Notes", prompt: "Build", hostUrl: "file:///tmp/schema" },
    ]) {
      const result = await client.callTool({ name: "create_app", arguments: argumentsValue });
      expect(result.isError).toBe(true);
    }
    expect(backend.createApp).not.toHaveBeenCalled();
    expect(backend.startRun).not.toHaveBeenCalled();
  });

  it("rejects unauthorized apps without starting their sub-agent", async () => {
    backend.findApp.mockRejectedValueOnce(new Error("App not found"));
    const client = await connect();
    expect(
      (
        await client.callTool({
          name: "edit_app",
          arguments: { appId: "other-app", prompt: "Edit", hostUrl },
        })
      ).isError,
    ).toBe(true);
    expect(backend.startRun).not.toHaveBeenCalled();
  });

  it("stops the observer when the HTTP request is aborted while the workflow continues", async () => {
    const workflow = run([], "running");
    backend.startRun.mockResolvedValue(workflow.value);
    const controller = new AbortController();
    const response = await handleAppAgentMcpRequest(
      new Request("https://platform.test/api/platform/app-agent/mcp", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "edit_app",
            arguments: { appId: "app-one", prompt: "Edit", hostUrl },
            _meta: { progressToken: "progress-one" },
          },
        }),
      }),
      backend,
    );
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(workflow.cancel).toHaveBeenCalledOnce());
    expect(workflow.output).not.toHaveBeenCalled();
    await reader.cancel();
  });

  it("detaches the observer when the SSE response body is cancelled", async () => {
    const workflow = run([], "running");
    backend.startRun.mockResolvedValue(workflow.value);
    const response = await handleAppAgentMcpRequest(
      new Request("https://platform.test/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "edit_app",
            arguments: { appId: "app-one", prompt: "Edit", hostUrl },
            _meta: { progressToken: "progress-one" },
          },
        }),
      }),
      backend,
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(workflow.cancel).toHaveBeenCalledOnce());
    expect(workflow.output).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests and does not open a standalone session stream", async () => {
    expect(
      (
        await handleAppAgentMcpRequest(
          new Request("https://platform.test/mcp", {
            method: "POST",
            headers: { Origin: "https://other.test" },
          }),
          backend,
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleAppAgentMcpRequest(new Request("https://platform.test/mcp"), backend)).status,
    ).toBe(405);
  });
});
