import { verifyAgentToken } from "@tailorkit/api-utils/agent-token";
import { app } from "@tailorkit/db/schema/apps";
import { organization } from "@tailorkit/db/schema/auth";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { project } from "@tailorkit/db/schema/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Context } from "./context";
import { env } from "./env";
import { canonicalizeScope } from "./scope";
import { createTestDb } from "./test/pglite";

const state = vi.hoisted(() => ({ db: undefined as unknown, start: vi.fn() }));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@tailorkit/kv", () => ({ getKV: () => undefined }));
vi.mock("@tailorkit/app-agent/workflows", () => ({
  appAgent: vi.fn(),
  deleteSandbox: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: state.start }));
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

const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "33333333-3333-4333-8333-333333333333";
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const otherScope = canonicalizeScope({ name: "org", value: { tenant: "two" } });

function request(name: string, args: Record<string, unknown> = {}) {
  return new Request("https://platform.test/api/platform/app-agent/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "x-tailorkit-context": Buffer.from(
        JSON.stringify({
          scopes: { org: scope.scope.value },
          subjectId: "user",
          hostUrl: "https://host.test/api/tailorkit",
        }),
      ).toString("base64url"),
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
          "io.modelcontextprotocol/clientInfo": { name: "isolation-test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

describe("MCP database authorization", () => {
  let database: Awaited<ReturnType<typeof createTestDb>>;
  let context: Context;
  let otherContext: Context;
  let ownApp: typeof app.$inferSelect;
  let foreignApp: typeof app.$inferSelect;
  let outOfScopeApp: typeof app.$inferSelect;
  let existingGrants: (typeof cliToken.$inferSelect)[];

  beforeEach(async () => {
    vi.clearAllMocks();
    database = await createTestDb();
    state.db = database.db;
    const [org] = await database.db
      .insert(organization)
      .values({
        id: orgId,
        publicId: "team0000000001",
        name: "Test team",
        slug: "test-team",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();
    const [ownProject, otherProject] = await database.db
      .insert(project)
      .values([
        { id: projectId, organizationId: orgId, name: "Own", slug: "own" },
        { id: otherProjectId, organizationId: orgId, name: "Other", slug: "other" },
      ])
      .returning();
    context = {
      organization: org!,
      project: ownProject!,
      storage: {
        type: "s3",
        createDownloadUrl: vi.fn(),
        createUploadUrl: vi.fn(),
        delete: vi.fn(),
        head: vi.fn(),
      },
    };
    otherContext = { ...context, project: otherProject! };
    const apps = await database.db
      .insert(app)
      .values([
        { projectId, publicId: "ownapp000001", name: "Own", ...scope },
        { projectId: otherProjectId, publicId: "otherapp0001", name: "Other", ...scope },
        { projectId, publicId: "outscope0001", name: "Out of scope", ...otherScope },
      ])
      .returning();
    [ownApp, foreignApp, outOfScopeApp] = [apps[0]!, apps[1]!, apps[2]!];
    existingGrants = await database.db
      .insert(cliToken)
      .values([
        {
          projectId,
          ...scope,
          tokenHash: "own-existing",
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          projectId: otherProjectId,
          ...scope,
          tokenHash: "foreign-existing",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .returning();
    state.start.mockResolvedValue({
      runId: "run",
      cancel: vi.fn(),
      readable: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      returnValue: Promise.resolve({ messages: [] }),
    });
  });

  afterEach(async () => {
    await database.client.close();
  });

  it("lists only the authenticated project's exact scope", async () => {
    const response = await handleAppAgentMcpRequest(request("list_apps"), context);
    const events = await response.text();
    expect(events).toContain(ownApp.publicId);
    expect(events).not.toContain(foreignApp.publicId);
    expect(events).not.toContain(outOfScopeApp.publicId);
    const otherResponse = await handleAppAgentMcpRequest(request("list_apps"), otherContext);
    const otherEvents = await otherResponse.text();
    expect(otherEvents).toContain(foreignApp.publicId);
    expect(otherEvents).not.toContain(ownApp.publicId);
    expect(otherEvents).not.toContain(outOfScopeApp.publicId);
    expect(state.start).not.toHaveBeenCalled();
    expect(await database.db.select().from(cliToken)).toEqual(existingGrants);
  });

  it("rejects foreign-project and foreign-scope IDs without changing apps or grants", async () => {
    const initialApps = await database.db.select().from(app);
    for (const deniedApp of [foreignApp, outOfScopeApp]) {
      for (const appId of [deniedApp.id, deniedApp.publicId]) {
        const response = await handleAppAgentMcpRequest(
          request("edit_app", { appId, prompt: "Change it" }),
          context,
        );
        expect(await response.text()).toContain('"isError":true');
      }
    }
    expect(state.start).not.toHaveBeenCalled();
    expect(await database.db.select().from(app)).toEqual(initialApps);
    expect(await database.db.select().from(cliToken)).toEqual(existingGrants);
  });

  it("creates and revokes only its own single-scope agent grant", async () => {
    const response = await handleAppAgentMcpRequest(
      request("edit_app", { appId: ownApp.publicId, prompt: "Change it" }),
      context,
    );
    expect(await response.text()).not.toContain('"isError":true');
    expect(state.start).toHaveBeenCalledOnce();
    const grants = await database.db.select().from(cliToken);
    const grant = grants.find(({ id }) => !existingGrants.some((existing) => existing.id === id));
    expect(grants).toHaveLength(3);
    expect(grant).toMatchObject({
      projectId,
      scopeKey: scope.scopeKey,
      scope: scope.scope,
      revokedAt: expect.any(Date),
    });
    expect(grants.filter(({ id }) => id !== grant!.id)).toEqual(existingGrants);
    const input = state.start.mock.lastCall![1][0];
    expect(
      await verifyAgentToken(input.agentToken, env.AUTH_SECRET!, env.OPENAPI_SERVER_URL!),
    ).toMatchObject({
      projectId,
      appId: ownApp.id,
      cliTokenId: grant!.id,
      scope: scope.scope,
    });
  });

  it("creates the app and agent grant in the authenticated project and selected scope", async () => {
    const response = await handleAppAgentMcpRequest(
      request("create_app", { name: "New app", scope: "org", prompt: "Build it" }),
      context,
    );
    expect(await response.text()).not.toContain('"isError":true');
    const apps = await database.db.select().from(app);
    const created = apps.find(({ name }) => name === "New app");
    expect(apps).toHaveLength(4);
    expect(created).toMatchObject({ projectId, scopeKey: scope.scopeKey, scope: scope.scope });
    expect(state.start.mock.lastCall![1][0].appId).toBe(created!.id);
    const grants = await database.db.select().from(cliToken);
    expect(
      grants.filter(({ id }) => existingGrants.some((existing) => existing.id === id)),
    ).toEqual(existingGrants);
    expect(
      grants.find(({ id }) => !existingGrants.some((existing) => existing.id === id)),
    ).toMatchObject({
      projectId,
      scope: scope.scope,
      revokedAt: expect.any(Date),
    });
  });
});
