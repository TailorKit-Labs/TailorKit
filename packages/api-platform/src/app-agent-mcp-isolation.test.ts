/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-argument, typescript/no-unsafe-member-access -- This integration fixture loads workspace or generated modules dynamically and supplies minimal platform doubles; its assertions validate the observed runtime contract. */
import { verifyAgentToken } from "@tailorkit/api-utils/agent-token";
import { app } from "@tailorkit/db/schema/apps";
import { organization } from "@tailorkit/db/schema/auth";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { project } from "@tailorkit/db/schema/project";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type { Context } from "./context";
import { env } from "./env";
import { canonicalizeScope } from "./scope";
import { createTestDb } from "./test/pglite";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const state = vi.hoisted(() => ({ db: undefined as unknown, start: vi.fn() }));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@tailorkit/kv", () => ({ getKV: () => {} }));
vi.mock("@tailorkit/agent/workflows", () => ({
  appAgent: vi.fn(),
  cancelAppAgent: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: state.start }));
vi.mock("@tailorkit/api-utils/dev-delay", () => ({
  devDelayMiddleware: async <TResult>({ next }: { next: () => TResult }) =>
    await next(),
}));
vi.mock("@tailorkit/api-utils/rate-limiting", () => ({
  createRateLimiter: vi.fn(),
  ratelimitMiddleware:
    () =>
    async <TResult>({ next }: { next: () => TResult }) =>
      await next(),
}));
const { handleAppAgentMcpRequest } = await import("./app-agent-mcp");

const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "33333333-3333-4333-8333-333333333333";
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const otherScope = canonicalizeScope({ name: "org", value: { tenant: "two" } });

const request = (
  name: string,
  args: Parameters<typeof JSON.stringify>[0] = {}
) =>
  new Request("https://platform.test/api/platform/app-agent/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "isolation-test",
            version: "1",
          },
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        },
        arguments: args,
        name,
      },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": name,
      "mcp-protocol-version": "2026-07-28",
      "x-tailorkit-context": Buffer.from(
        JSON.stringify({
          hostUrl: "https://host.test/api/tailorkit",
          scopes: { org: scope.scope.value },
          subjectId: "user",
        })
      ).toString("base64url"),
    },
    method: "POST",
  });

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
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: orgId,
        name: "Test team",
        publicId: "team0000000001",
        slug: "test-team",
      })
      .returning();
    const [ownProject, otherProject] = await database.db
      .insert(project)
      .values([
        { id: projectId, name: "Own", organizationId: orgId, slug: "own" },
        {
          id: otherProjectId,
          name: "Other",
          organizationId: orgId,
          slug: "other",
        },
      ])
      .returning();
    context = {
      organization: requireValue(org),
      project: requireValue(ownProject),
      storage: {
        createDownloadUrl: vi.fn(),
        createUploadUrl: vi.fn(),
        delete: vi.fn(),
        head: vi.fn(),
        type: "s3",
      },
    };
    otherContext = { ...context, project: requireValue(otherProject) };
    const apps = await database.db
      .insert(app)
      .values([
        { name: "Own", projectId, publicId: "ownapp000001", ...scope },
        {
          name: "Other",
          projectId: otherProjectId,
          publicId: "otherapp0001",
          ...scope,
        },
        {
          name: "Out of scope",
          projectId,
          publicId: "outscope0001",
          ...otherScope,
        },
      ])
      .returning();
    [ownApp, foreignApp, outOfScopeApp] = [
      requireValue(apps[0]),
      requireValue(apps[1]),
      requireValue(apps[2]),
    ];
    existingGrants = await database.db
      .insert(cliToken)
      .values([
        {
          projectId,

          ...scope,

          expiresAt: new Date(Date.now() + 60_000),

          tokenHash: "own-existing",
        },
        {
          projectId: otherProjectId,

          ...scope,

          expiresAt: new Date(Date.now() + 60_000),

          tokenHash: "foreign-existing",
        },
      ])
      .returning();
    state.start.mockResolvedValue({
      cancel: vi.fn(),
      getReadable: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      returnValue: Promise.resolve({ finishReason: "stop" }),
      runId: "run",
    });
  });

  afterEach(async () => {
    await database.client.close();
  });

  it("lists only the authenticated project's exact scope", async () => {
    const response = await handleAppAgentMcpRequest(
      request("list_apps"),
      context
    );
    const events = await response.text();
    expect(events).toContain(ownApp.publicId);
    expect(events).not.toContain(foreignApp.publicId);
    expect(events).not.toContain(outOfScopeApp.publicId);
    const otherResponse = await handleAppAgentMcpRequest(
      request("list_apps"),
      otherContext
    );
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
        // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
        const response = await handleAppAgentMcpRequest(
          request("edit_app", { appId, prompt: "Change it" }),
          context
        );
        // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
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
      context
    );
    expect(await response.text()).not.toContain('"isError":true');
    expect(state.start).toHaveBeenCalledOnce();
    const grants = await database.db.select().from(cliToken);
    const grant = grants.find(
      ({ id }) => !existingGrants.some((existing) => existing.id === id)
    );
    expect(grants).toHaveLength(3);
    expect(grant).toMatchObject({
      projectId,
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matchers intentionally return any; this value is used only to describe an assertion, not as application data.
      revokedAt: expect.any(Date),
      scope: scope.scope,
      scopeKey: scope.scopeKey,
    });
    expect(grants.filter(({ id }) => id !== requireValue(grant).id)).toEqual(
      existingGrants
    );
    const [, [input]] = requireValue(state.start.mock.lastCall);
    expect(
      await verifyAgentToken(
        input.agentToken,
        requireValue(env.AUTH_SECRET),
        requireValue(env.OPENAPI_SERVER_URL)
      )
    ).toMatchObject({
      appId: ownApp.id,
      cliTokenId: requireValue(grant).id,
      projectId,
      scope: scope.scope,
    });
  });

  it("creates the app and agent grant in the authenticated project and selected scope", async () => {
    const response = await handleAppAgentMcpRequest(
      request("create_app", {
        name: "New app",
        prompt: "Build it",
        scope: "org",
      }),
      context
    );
    expect(await response.text()).not.toContain('"isError":true');
    const apps = await database.db.select().from(app);
    const created = apps.find(({ name }) => name === "New app");
    expect(apps).toHaveLength(4);
    expect(created).toMatchObject({
      projectId,
      scope: scope.scope,
      scopeKey: scope.scopeKey,
    });
    expect(requireValue(state.start.mock.lastCall)[1][0].appId).toBe(
      requireValue(created).id
    );
    const grants = await database.db.select().from(cliToken);
    expect(
      grants.filter(({ id }) =>
        existingGrants.some((existing) => existing.id === id)
      )
    ).toEqual(existingGrants);
    expect(
      grants.find(
        ({ id }) => !existingGrants.some((existing) => existing.id === id)
      )
    ).toMatchObject({
      projectId,
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matchers intentionally return any; this value is used only to describe an assertion, not as application data.
      revokedAt: expect.any(Date),
      scope: scope.scope,
    });
  });
});
