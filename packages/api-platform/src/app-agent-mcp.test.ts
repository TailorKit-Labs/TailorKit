import { os } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { verifyAgentToken } from "@tailorkit/api-utils/agent-token";
import { env } from "./env";
import type { Context } from "./context";
import { canonicalizeScope } from "./scope";

const mocks = vi.hoisted(() => ({
  app: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  start: vi.fn(),
  cleanup: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@tailorkit/db", () => ({
  db: {
    query: { app: { findFirst: mocks.app } },
    insert: () => ({
      values: (value: unknown) => {
        mocks.grant(value);
        return { returning: async () => [{ id: "grant" }] };
      },
    }),
    update: () => ({ set: (value: unknown) => ({ where: () => mocks.revoke(value) }) }),
  },
}));
vi.mock("./routes/apps", () => ({
  appRouter: {
    list: os.handler(mocks.list),
    create: os.handler(mocks.create),
  },
}));
vi.mock("@tailorkit/app-agent/workflows", () => ({
  appAgent: vi.fn(),
  deleteSandbox: mocks.cleanup,
}));
vi.mock("workflow/api", () => ({ start: mocks.start }));
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

const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const context = { project: { id: "project" }, organization: { id: "org" } } as Context;
const identity = { scopes: { org: scope.scope.value }, subjectId: "user" };
const app = { id: "internal-app", publicId: "public-app", scope: scope.scope };

function request(name: string, args: Record<string, unknown> = {}, overrides = {}, headers = {}) {
  const context = { ...identity, hostUrl: "https://host.test/api/tailorkit", ...overrides };
  return new Request("https://platform.test/api/platform/app-agent/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "x-tailorkit-context": Buffer.from(JSON.stringify(context), "utf8").toString("base64url"),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
          progressToken: "progress",
        },
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.mockResolvedValue(app);
  mocks.create.mockResolvedValue({ body: app });
  mocks.list.mockResolvedValue({ body: { items: [app], pagination: { hasMore: false } } });
  mocks.start.mockResolvedValue({
    runId: "run",
    cancel: mocks.cancel,
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", id: "text", text: "Building" });
        controller.close();
      },
    }),
    returnValue: Promise.resolve({ messages: [] }),
  });
});

describe("platform MCP endpoint", () => {
  it("lists only host scopes without starting an agent", async () => {
    const response = await handleAppAgentMcpRequest(request("list_apps"), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("public-app");
    expect(mocks.list.mock.lastCall![0].input.body).toEqual({
      page: 1,
      pageSize: 100,
      scopes: [scope.scope],
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("starts an authorized editor, streams events, and revokes its grant after cleanup", async () => {
    const response = await handleAppAgentMcpRequest(
      request("edit_app", { appId: "public-app", prompt: "Change it" }),
      context,
    );
    const events = await response.text();
    expect(events).toContain("notifications/progress");
    expect(events).toContain("Building");
    expect(mocks.start).toHaveBeenCalledOnce();
    const input = mocks.start.mock.lastCall![1][0];
    expect(input).toMatchObject({
      appId: app.id,
      hostUrl: "https://host.test/api/tailorkit",
      messages: [{ role: "user", content: "Change it" }],
    });
    expect(
      await verifyAgentToken(input.agentToken, env.AUTH_SECRET!, env.OPENAPI_SERVER_URL!),
    ).toMatchObject({
      projectId: "project",
      appId: app.id,
      cliTokenId: "grant",
      scope: scope.scope,
    });
    expect(input.schema).toBeUndefined();
    expect(mocks.start.mock.lastCall![2].attributes).toMatchObject({
      "tailorkit.subjectId": "user",
    });
    expect(mocks.grant.mock.lastCall![0]).toMatchObject({
      projectId: "project",
      scopeKey: scope.scopeKey,
      scope: scope.scope,
    });
    expect(mocks.revoke).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("creates the installation in a host scope before launching its builder agent", async () => {
    const response = await handleAppAgentMcpRequest(
      request("create_app", { name: "Todo", scope: "org", prompt: "Build it" }),
      context,
    );
    await response.text();
    expect(mocks.create.mock.lastCall![0].input.body).toEqual({
      name: "Todo",
      description: null,
      scope: scope.scope,
    });
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("rejects unauthorized app/scope selections without grants or agents", async () => {
    mocks.app.mockResolvedValue(null);
    const missing = await handleAppAgentMcpRequest(
      request("edit_app", { appId: "other", prompt: "Change" }),
      context,
    );
    expect(await missing.text()).toContain('"isError":true');
    const invalid = await handleAppAgentMcpRequest(
      request("create_app", { name: "Todo", scope: "other", prompt: "Build" }),
      context,
    );
    expect(await invalid.text()).toContain('"isError":true');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects service/agent credentials and malformed host identities", async () => {
    for (const restricted of [{ runtimeService: true }, { agentToken: {} }]) {
      expect(
        (
          await handleAppAgentMcpRequest(request("list_apps"), {
            ...context,
            ...restricted,
          } as Context)
        ).status,
      ).toBe(403);
    }
    for (const invalid of [{ scopes: {} }, { subjectId: "" }, { scopes: { org: {} } }]) {
      expect(
        (await handleAppAgentMcpRequest(request("list_apps", {}, invalid), context)).status,
      ).toBe(400);
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects malformed/oversized context headers and cross-origin requests", async () => {
    for (const encoded of ["", "not+base64", "eyJ9=", "x".repeat(8193), "_w"]) {
      expect(
        (
          await handleAppAgentMcpRequest(
            request("list_apps", {}, {}, { "x-tailorkit-context": encoded }),
            context,
          )
        ).status,
      ).toBe(400);
    }
    const unexpected = await handleAppAgentMcpRequest(
      request("list_apps", {}, { schema: {} }),
      context,
    );
    expect(unexpected.status).toBe(400);
    const origin = await handleAppAgentMcpRequest(
      request("list_apps", {}, {}, { origin: "https://other.test" }),
      context,
    );
    expect(origin.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("keeps header context authoritative when tool arguments try to inject scopes", async () => {
    const response = await handleAppAgentMcpRequest(
      request("edit_app", {
        appId: "public-app",
        prompt: "Change",
        scopes: { org: { tenant: "other" } },
        subjectId: "other-user",
      }),
      context,
    );
    expect(await response.text()).toContain('"isError":true');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("cancels the workflow and deletes its sandbox when the response closes", async () => {
    let revoked!: () => void;
    const revocation = new Promise<void>((resolve) => {
      revoked = resolve;
    });
    mocks.revoke.mockImplementation(revoked);
    mocks.start.mockResolvedValueOnce({
      runId: "run",
      cancel: mocks.cancel,
      readable: new ReadableStream(),
      returnValue: new Promise(() => {}),
    });
    const response = await handleAppAgentMcpRequest(
      request("edit_app", { appId: "public-app", prompt: "Change" }),
      context,
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await revocation;
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledWith("app-agent-run");
  });

  it("waits for workflow cleanup before sending the terminal result", async () => {
    let finish!: () => void;
    const returnValue = new Promise<{ messages: [] }>((resolve) => {
      finish = () => resolve({ messages: [] });
    });
    mocks.start.mockResolvedValueOnce({
      runId: "run",
      cancel: mocks.cancel,
      readable: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      returnValue,
    });
    const response = await handleAppAgentMcpRequest(
      request("edit_app", { appId: "public-app", prompt: "Change" }),
      context,
    );
    const reader = response.body!.getReader();
    await reader.read();
    const final = reader.read();
    expect(mocks.revoke).not.toHaveBeenCalled();
    finish();
    await final;
    while (!(await reader.read()).done) {
      /* drain */
    }
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it("cancels an unfinished agent after a stream failure while the request stays active", async () => {
    const input = request("edit_app", { appId: "public-app", prompt: "Change" });
    mocks.start.mockResolvedValueOnce({
      runId: "run",
      cancel: mocks.cancel,
      readable: new ReadableStream({
        start(controller) {
          controller.error(new Error("Agent stream failed"));
        },
      }),
      returnValue: new Promise(() => {}),
    });
    const response = await handleAppAgentMcpRequest(input, context);
    expect(await response.text()).toContain("Agent stream failed");
    expect(input.signal.aborted).toBe(false);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledWith("app-agent-run");
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it("still deletes the sandbox and revokes the grant when workflow cancellation fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.cancel.mockRejectedValueOnce(new Error("Cancellation unavailable"));
    mocks.start.mockResolvedValueOnce({
      runId: "run",
      cancel: mocks.cancel,
      readable: new ReadableStream({
        start(controller) {
          controller.error(new Error("Agent stream failed"));
        },
      }),
      returnValue: new Promise(() => {}),
    });
    try {
      const response = await handleAppAgentMcpRequest(
        request("edit_app", { appId: "public-app", prompt: "Change" }),
        context,
      );
      const events = await response.text();
      expect(events).toContain("Agent stream failed");
      expect(events).not.toContain("Cancellation unavailable");
      expect(warning).toHaveBeenCalledOnce();
      expect(mocks.cleanup).toHaveBeenCalledWith("app-agent-run");
      expect(mocks.revoke).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it("surfaces setup failures without waiting for an unopened model stream", async () => {
    mocks.start.mockResolvedValueOnce({
      runId: "run",
      cancel: mocks.cancel,
      readable: new ReadableStream(),
      get returnValue() {
        return Promise.reject(new Error("This app is already being edited."));
      },
    });
    const response = await handleAppAgentMcpRequest(
      request("edit_app", { appId: "public-app", prompt: "Change" }),
      context,
    );
    expect(await response.text()).toContain("already being edited");
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });
});
