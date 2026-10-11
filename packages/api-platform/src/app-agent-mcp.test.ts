import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "./context";
import { canonicalizeScope } from "./scope";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  token: vi.fn(),
  findApp: vi.fn(),
  call: vi.fn(),
  start: vi.fn(),
  getRun: vi.fn(),
  metadata: vi.fn(),
  handle: vi.fn(),
}));
vi.mock("./context", () => ({ createContext: mocks.context }));
vi.mock("./cli-token", () => ({ authenticateCli: mocks.token }));
vi.mock("./procedures", () => ({ findAppInScopes: mocks.findApp }));
vi.mock("./routes/apps", () => ({ appRouter: { list: "list", create: "create" } }));
vi.mock("./routes/app-agent", () => ({ APP_AGENT_MODEL: "openai/gpt-6.1-sol" }));
vi.mock("@tailorkit/app-agent/workflows", () => ({ appAgent: "app-workflow" }));
vi.mock("@tailorkit/app-agent/mcp", () => ({ handleAppAgentMcpRequest: mocks.handle }));
vi.mock("@orpc/server", async (original) => ({
  ...(await original<typeof import("@orpc/server")>()),
  call: mocks.call,
}));
vi.mock("workflow/api", () => ({ start: mocks.start, getRun: mocks.getRun }));
vi.mock("workflow/runtime", () => ({ getWorld: async () => ({ runs: { get: mocks.metadata } }) }));

const { createAppAgentMcpBackend, handlePlatformAppAgentMcpRequest } =
  await import("./app-agent-mcp");
const context = { project: { id: "project-one" }, organization: { id: "org-one" } } as Context;
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const host = { hostUrl: "http://localhost:3001/api/tailorkit", schema: { components: {} } };
const app = { id: "app-one", publicId: "public-one", name: "Notes", description: null, views: [] };
const backend = createAppAgentMcpBackend(context, scope.scope);

function request(
  headers: Record<string, string> = {
    Authorization: "Bearer project-key",
    "X-TailorKit-Deploy-Token": "scope-token",
  },
) {
  return new Request("https://platform.test/api/platform/app-agent/mcp", {
    method: "POST",
    headers,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.token.mockResolvedValue({ scope: scope.scope });
  mocks.findApp.mockResolvedValue(app);
  mocks.handle.mockResolvedValue(new Response("MCP response"));
  mocks.metadata.mockResolvedValue({
    attributes: { agent: "tailorkit-app-agent", projectId: "project-one", appId: "app-one" },
  });
});

describe("platform app-agent MCP authorization", () => {
  it("requires a project credential and scope token before constructing the MCP server", async () => {
    const response = await handlePlatformAppAgentMcpRequest(request());
    expect(await response.text()).toBe("MCP response");
    expect(mocks.context).toHaveBeenCalledWith({ request: expect.any(Request) });
    expect(mocks.token).toHaveBeenCalledWith("project-one", "scope-token", undefined);
    expect(mocks.handle).toHaveBeenCalledOnce();
  });

  it("rejects missing/invalid credentials and expired/revoked tokens before invoking MCP", async () => {
    expect((await handlePlatformAppAgentMcpRequest(request({}))).status).toBe(401);
    mocks.context.mockRejectedValueOnce(new Error("Invalid project key"));
    expect((await handlePlatformAppAgentMcpRequest(request())).status).toBe(401);
    mocks.token.mockRejectedValueOnce(new ORPCError("UNAUTHORIZED"));
    expect((await handlePlatformAppAgentMcpRequest(request())).status).toBe(401);
    mocks.token.mockRejectedValueOnce(new ORPCError("FORBIDDEN"));
    expect((await handlePlatformAppAgentMcpRequest(request())).status).toBe(403);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before authenticating", async () => {
    expect(
      (await handlePlatformAppAgentMcpRequest(request({ Origin: "https://other.test" }))).status,
    ).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("binds list/create to the token scope rather than accepting caller-selected scopes", async () => {
    mocks.call.mockResolvedValueOnce({
      body: { items: [app], pagination: { page: 2, pageSize: 10, hasMore: true } },
    });
    expect(await backend.listApps({ page: 2, pageSize: 10 })).toMatchObject({ items: [app] });
    expect(mocks.call).toHaveBeenLastCalledWith(
      "list",
      { body: { scopes: [scope.scope], page: 2, pageSize: 10 } },
      { context },
    );
    mocks.call.mockResolvedValueOnce({ body: app });
    await backend.createApp({ name: "Notes" });
    expect(mocks.call).toHaveBeenLastCalledWith(
      "create",
      { body: { name: "Notes", description: null, scope: scope.scope } },
      { context },
    );
  });

  it("uses the authorized canonical app ID for the sub-agent and its ownership metadata", async () => {
    await backend.startRun("public-alias", "Add a page", host);
    expect(mocks.findApp).toHaveBeenCalledWith("project-one", "public-alias", [scope]);
    expect(mocks.start).toHaveBeenCalledWith(
      "app-workflow",
      [
        {
          appId: "app-one",
          hostUrl: host.hostUrl,
          schema: host.schema,
          model: "openai/gpt-6.1-sol",
          messages: [{ role: "user", content: "Add a page" }],
        },
      ],
      {
        attributes: { agent: "tailorkit-app-agent", projectId: "project-one", appId: "app-one" },
      },
    );
  });

  it("rejects apps outside the project/scope before starting or reading a run", async () => {
    mocks.findApp.mockRejectedValue(new ORPCError("NOT_FOUND"));
    await expect(backend.startRun("other-app", "Edit", host)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(backend.getRun("other-app", "run-one")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(mocks.getRun).not.toHaveBeenCalled();
  });

  it("checks run ownership before returning a handle with readable data", async () => {
    await backend.getRun("public-alias", "run-one");
    expect(mocks.metadata).toHaveBeenCalledWith("run-one", { resolveData: "none" });
    expect(mocks.getRun).toHaveBeenCalledWith("run-one");
    mocks.getRun.mockClear();
    for (const attributes of [
      undefined,
      { agent: "other-agent", projectId: "project-one", appId: "app-one" },
      { agent: "tailorkit-app-agent", projectId: "other-project", appId: "app-one" },
      { agent: "tailorkit-app-agent", projectId: "project-one", appId: "other-app" },
    ]) {
      mocks.metadata.mockResolvedValueOnce({ attributes });
      await expect(backend.getRun("app-one", "other-run")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(mocks.getRun).not.toHaveBeenCalled();
  });

  it("handles unknown run IDs without leaking workflow metadata", async () => {
    mocks.metadata.mockRejectedValueOnce(new Error("Workflow run not found"));
    await expect(backend.getRun("app-one", "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getRun).not.toHaveBeenCalled();
  });
});
