import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { call } from "@orpc/server";
/* oxlint-disable require-await, typescript/no-non-null-assertion -- the in-memory KV fake implements Promise methods. */
import {
  issueAgentToken,
  verifyAgentToken,
} from "@tailorkit/api-utils/agent-token";
import { RateLimitHandlerPlugin } from "@tailorkit/api-utils/rate-limiting";
import { app as appTable } from "@tailorkit/db/schema/apps";
import { organization } from "@tailorkit/db/schema/auth";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { previewSession } from "@tailorkit/db/schema/preview-session";
import { project as projectTable } from "@tailorkit/db/schema/project";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type { Context } from "#context";
import { env } from "#env";
import { createTestDb } from "#test/pglite";

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  kv: undefined as unknown,
}));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@tailorkit/kv", async (original) => ({
  ...(await original()),
  getKV: () => state.kv,
}));

const { previewRouter } = await import("./preview");
const { canonicalizeScope } = await import("#scope");
const { authorizePreviewSocket } = await import("#preview-ws-auth");
const { previewWebSocketRouter } = await import("#preview-ws");
const authSecret = env.AUTH_SECRET;
if (!(authSecret !== undefined && authSecret !== null && authSecret !== "")) {
  throw new Error(
    "The preview test requires AUTH_SECRET in its Vitest config."
  );
}
const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const tokenId = "33333333-3333-4333-8333-333333333333";
const authorScope = { name: "user", value: { userId: "author" } };
const otherHostScope = { name: "user", value: { userId: "other" } };
const viewerScope = { name: "user", value: { userId: "viewer" } };

const fakeKV = () => {
  const data = new Map<string, string>();
  return {
    delete: async (key: string) => {
      data.delete(key);
    },
    get: async (key: string) => data.get(key) ?? null,
    getAndDelete: async (key: string) => {
      const value = data.get(key) ?? null;
      data.delete(key);
      return value;
    },
    increment: async () => 1,
    keepPreviewSessionIfDeveloperPresent: async (
      presenceKey: string,
      seenKey: string,
      endedKey: string,
      _endedTtl: number,
      expireUnseen = false
    ) => {
      if (data.has(endedKey)) {
        return false;
      }
      if (data.has(presenceKey) || (!data.has(seenKey) && !expireUnseen)) {
        return true;
      }
      data.set(endedKey, "1");
      return false;
    },
    publish: async () => 0,
    set: async (key: string, value: string) => {
      data.set(key, value);
    },
    setPreviewPresenceIfActive: async (
      presenceKey: string,
      seenKey: string,
      endedKey: string,
      value: string
    ) => {
      if (data.has(endedKey)) {
        return false;
      }
      data.set(presenceKey, value);
      data.set(seenKey, "1");
      return true;
    },
    subscribe: async () => async () => {},
  };
};

const context: Context = {
  organization: {
    createdAt: new Date(),
    id: orgId,
    logo: null,
    metadata: null,
    name: "Team",
    publicId: "team0000000001",
    slug: "team",
  },
  project: {
    createdAt: new Date(),
    id: projectId,
    name: "Project",
    organizationId: orgId,
    slug: "project",
    updatedAt: new Date(),
  },
  storage: {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    type: "s3",
  },
};

const startImplementation = async () =>
  await call(
    previewRouter.start,
    { body: { appId: "authapp00001", deployToken: "deploy-token" } },
    { context }
  );

describe("platform preview lifecycle and grants", () => {
  let kv: ReturnType<typeof fakeKV>;
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];
  beforeEach(async () => {
    const testDb = await createTestDb();
    ({ client } = testDb);
    ({ db } = testDb);
    state.db = db;
    kv = fakeKV();
    state.kv = kv;
    await db.insert(organization).values({
      createdAt: new Date(),
      id: orgId,
      name: "Team",
      publicId: "team0000000001",
      slug: "team",
    });
    await db.insert(projectTable).values({
      createdAt: new Date(),
      id: projectId,
      name: "Project",
      organizationId: orgId,
      slug: "project",
      updatedAt: new Date(),
    });
    const { hashSecret } = await import("@tailorkit/api-utils/hashing");
    await db.insert(cliToken).values({
      id: tokenId,

      projectId,

      ...canonicalizeScope(authorScope),

      expiresAt: new Date(Date.now() + 60_000),

      tokenHash: hashSecret("deploy-token", authSecret),
    });
    await db.insert(appTable).values([
      {
        name: "Author app",
        projectId,
        publicId: "authapp00001",
        ...canonicalizeScope(authorScope),
      },
      {
        name: "Other app",
        projectId,
        publicId: "otherapp0001",
        ...canonicalizeScope(otherHostScope),
      },
    ]);
  });
  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  const start = startImplementation;

  it("serves prefixed GET routes with validated path parameters", async () => {
    const started = await start();
    const handler = new OpenAPIHandler(
      { preview: previewRouter },
      { plugins: [new RateLimitHandlerPlugin()] }
    );
    const handle = async (shareId: string) =>
      await handler.handle(
        new Request(
          `https://example.com/api/platform/preview/shares/${shareId}`
        ),
        {
          context,
          prefix: "/api/platform",
        }
      );

    const invitation = await handle(started.body.shareId);
    expect(invitation.matched).toBe(true);
    expect(invitation.response?.status).toBe(200);
    await expect(invitation.response?.json()).resolves.toMatchObject({
      appName: "Author app",
      sessionId: started.body.sessionId,
    });

    const invalid = await handle("invalid-share-id");
    expect(invalid.matched).toBe(true);
    expect(invalid.response?.status).toBe(400);
  });

  it("enforces author scope, active uniqueness, expiry retirement, and CLI revocation", async () => {
    await expect(
      call(
        previewRouter.start,
        { body: { appId: "otherapp0001", deployToken: "deploy-token" } },
        { context }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const first = await start();
    expect(first.body.shareId).toHaveLength(43);
    expect(first.body.tunnelUrl).toContain("/api/platform/preview/ws");
    await expect(start()).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "ACTIVE_PREVIEW_EXISTS" },
    });
    const expiredBuildId = "expired_build";
    const manifest = {
      files: [
        {
          chunks: 1,
          contentType: "text/javascript",
          path: "client.js",
          sha256: "0".repeat(64),
          size: 1,
        },
      ],
    };
    const buildKey = `preview:build:${first.body.sessionId}:${expiredBuildId}`;
    await kv.set(
      `preview:current:${first.body.sessionId}`,
      JSON.stringify({ buildId: expiredBuildId, manifest, revision: 1 })
    );
    await kv.set(
      buildKey,
      JSON.stringify({ manifest, revision: 1, state: "ready" })
    );
    await kv.set(`${buildKey}:0:0`, "YQ==");
    await db
      .update(previewSession)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(previewSession.id, first.body.sessionId));
    const second = await start();
    expect(second.body.sessionId).not.toBe(first.body.sessionId);
    expect(await kv.get(`preview:current:${first.body.sessionId}`)).toBeNull();
    expect(await kv.get(buildKey)).toBeNull();
    expect(await kv.get(`${buildKey}:0:0`)).toBeNull();
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
    await db
      .update(cliToken)
      .set({ revokedAt: new Date() })
      .where(eq(cliToken.id, tokenId));
    await expect(start()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      await authorizePreviewSocket(
        second.body.sessionId,
        second.body.tunnelToken,
        "uploader"
      )
    ).toBeNull();
    const revokedSession = await db.query.previewSession.findFirst({
      where: { id: second.body.sessionId },
    });
    expect(revokedSession?.status).toBe("ended");
    expect(await kv.get(`preview:ended:${second.body.sessionId}`)).toBe("1");
  });

  it("rejects a CLI token whose stored scope is malformed", async () => {
    await db
      .update(cliToken)
      .set({ scope: { name: "user", value: {} } })
      .where(eq(cliToken.id, tokenId));
    await expect(start()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("retires a session when its CLI token expires during a heartbeat", async () => {
    const started = await start();
    await db
      .update(cliToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(cliToken.id, tokenId));

    await expect(
      call(previewWebSocketRouter.heartbeat, undefined, {
        context: { role: "uploader", sessionId: started.body.sessionId },
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Preview CLI token is unavailable.",
    });
    const session = await db.query.previewSession.findFirst({
      where: { id: started.body.sessionId },
    });
    expect(session?.status).toBe("ended");
    expect(await kv.get(`preview:ended:${started.body.sessionId}`)).toBe("1");
  });

  it("retires a disconnected developer before checking the app conflict", async () => {
    const first = await start();
    await kv.set(`preview:developer-seen:${first.body.sessionId}`, "1");
    await kv.set(
      `preview:developer-connection:${first.body.sessionId}`,
      "connected"
    );
    await expect(start()).rejects.toMatchObject({ code: "CONFLICT" });

    await kv.delete(`preview:developer-connection:${first.body.sessionId}`);
    const replacement = await start();
    expect(replacement.body.sessionId).not.toBe(first.body.sessionId);
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
    const oldSession = await db.query.previewSession.findFirst({
      where: { id: first.body.sessionId },
    });
    expect(oldSession?.status).toBe("ended");
  });

  it("retires a session that never connected after its first-connection grace", async () => {
    const first = await start();
    await expect(start()).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(previewSession)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(previewSession.id, first.body.sessionId));

    const replacement = await start();
    expect(replacement.body.sessionId).not.toBe(first.body.sessionId);
    expect(await kv.get(`preview:ended:${first.body.sessionId}`)).toBe("1");
  });

  it("binds grants to the viewer scope and invalidates them on stop", async () => {
    const started = await start();
    const accepted = await call(
      previewRouter.accept,
      {
        body: { scope: viewerScope },
        params: { shareId: started.body.shareId },
      },
      { context }
    );
    const wrongScope = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopes: [otherHostScope] } },
      { context }
    );
    expect(wrongScope.body.items).toEqual([]);
    await kv.set(
      `preview:current:${started.body.sessionId}`,
      JSON.stringify({
        buildId: "build",
        manifest: {
          files: [],
          views: [
            { instances: true, path: "/", slot: "page" },
            { disabled: true, path: "/disabled", slot: "page" },
          ],
        },
        revision: 1,
      })
    );
    const viewer = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopes: [viewerScope] } },
      { context }
    );
    expect(viewer.body.items).toHaveLength(1);
    expect(viewer.body.items[0]?.app.views).toEqual([
      { instances: true, path: "/", slot: "page" },
      { disabled: true, path: "/disabled", slot: "page" },
    ]);
    expect(viewer.body.items[0]?.preview.token).toBeTruthy();
    await call(
      previewRouter.stop,
      {
        body: { deployToken: "deploy-token" },
        params: { sessionId: started.body.sessionId },
      },
      { context }
    );
    const ended = await call(
      previewRouter.accepted,
      { body: { grantIds: [accepted.body.grantId], scopes: [viewerScope] } },
      { context }
    );
    expect(ended.body.items).toEqual([]);
  });

  it("retries KV cleanup after the session was durably stopped", async () => {
    const started = await start();
    const buildId = "retry_build";
    const buildKey = `preview:build:${started.body.sessionId}:${buildId}`;
    const chunkKey = `${buildKey}:0:0`;
    const manifest = {
      files: [
        {
          chunks: 1,
          contentType: "text/javascript",
          path: "client.js",
          sha256: "0".repeat(64),
          size: 1,
        },
      ],
    };
    await kv.set(
      `preview:current:${started.body.sessionId}`,
      JSON.stringify({ buildId, manifest, revision: 1 })
    );
    await kv.set(
      buildKey,
      JSON.stringify({ manifest, revision: 1, state: "ready" })
    );
    await kv.set(chunkKey, "YQ==");
    const remove = kv.delete;
    let failOnce = true;
    kv.delete = async (key) => {
      if (key === chunkKey && failOnce) {
        failOnce = false;
        throw new Error("KV cleanup failed");
      }
      await remove(key);
    };
    const stop = async () =>
      await call(
        previewRouter.stop,
        {
          body: { deployToken: "deploy-token" },
          params: { sessionId: started.body.sessionId },
        },
        { context }
      );

    await expect(stop()).rejects.toThrow("KV cleanup failed");
    const session = await db.query.previewSession.findFirst({
      where: { id: started.body.sessionId },
    });
    expect(session?.status).toBe("ended");
    expect(
      await kv.get(`preview:current:${started.body.sessionId}`)
    ).not.toBeNull();
    await expect(stop()).resolves.toEqual({ body: {} });
    expect(
      await kv.get(`preview:current:${started.body.sessionId}`)
    ).toBeNull();
    expect(await kv.get(buildKey)).toBeNull();
    expect(await kv.get(chunkKey)).toBeNull();
  });

  it("ends an idle viewer stream when its bearer token expires", async () => {
    const started = await start();

    const current = vi.spyOn(kv, "get");
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
      ],
    });
    const deadline = Date.now() + 1000;
    const clock = vi.spyOn(Date, "now");
    try {
      const stream = await call(previewWebSocketRouter.subscribe, undefined, {
        context: {
          role: "viewer",
          sessionId: started.body.sessionId,
          viewerTokenExpiresAt: deadline,
        },
      });
      const iterator = stream[Symbol.asyncIterator]();
      const expired = expect(iterator.next()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await vi.waitFor(() => {
        expect(current).toHaveBeenCalledWith(
          `preview:current:${started.body.sessionId}`
        );
      });
      // Simulate a timer waking just before the wall-clock expiry deadline.
      clock.mockReturnValue(deadline - 1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.getTimerCount()).toBe(2);
      clock.mockRestore();
      await vi.advanceTimersByTimeAsync(1);
      await expired;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
      current.mockRestore();
    }
  });

  it("allows five active apps per scope, retires expired sessions, and frees a slot on stop", async () => {
    const appIds = Array.from(
      { length: 7 },
      (_, index) => `scopeapp${String(index).padStart(4, "0")}`
    );
    await db.insert(appTable).values(
      appIds.map((publicId) => ({
        name: publicId,
        projectId,
        publicId,
        ...canonicalizeScope(authorScope),
      }))
    );
    const startApp = async (appId: string) =>
      await call(
        previewRouter.start,
        { body: { appId, deployToken: "deploy-token" } },
        { context }
      );
    const started = await Promise.all(appIds.slice(0, 5).map(startApp));
    await expect(startApp(appIds[5]!)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This scope already has 5 active previews.",
    });
    const { hashSecret } = await import("@tailorkit/api-utils/hashing");
    await db.insert(cliToken).values({
      id: "44444444-4444-4444-8444-444444444444",

      projectId,

      ...canonicalizeScope(otherHostScope),

      expiresAt: new Date(Date.now() + 60_000),

      tokenHash: hashSecret("other-token", authSecret),
    });
    const otherScope = await call(
      previewRouter.start,
      { body: { appId: "otherapp0001", deployToken: "other-token" } },
      { context }
    );
    expect(otherScope.body.sessionId).toBeTruthy();
    await db
      .update(previewSession)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(previewSession.id, started[0]!.body.sessionId));
    const replacement = await startApp(appIds[5]!);
    expect(replacement.body.sessionId).toBeTruthy();
    await expect(startApp(appIds[6]!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await call(
      previewRouter.stop,
      {
        body: { deployToken: "deploy-token" },
        params: { sessionId: started[1]!.body.sessionId },
      },
      { context }
    );
    const afterStop = await startApp(appIds[6]!);
    expect(afterStop.body.sessionId).toBeTruthy();
  });

  // PGlite uses one connection here; this checks the cap and error, not PostgreSQL row locking.
  it("enforces the scope cap when several starts are requested together", async () => {
    const appIds = Array.from(
      { length: 6 },
      (_, index) => `raceapp${String(index).padStart(5, "0")}`
    );
    await db.insert(appTable).values(
      appIds.map((publicId) => ({
        name: publicId,
        projectId,
        publicId,
        ...canonicalizeScope(authorScope),
      }))
    );
    const results = await Promise.allSettled(
      appIds.map(
        async (appId) =>
          await call(
            previewRouter.start,
            { body: { appId, deployToken: "deploy-token" } },
            { context }
          )
      )
    );
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(5);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "CONFLICT",
      message: "This scope already has 5 active previews.",
    });
  });

  it("supports JWT preview authorization through source expiry, bounded by the JWT deadline", async () => {
    const jwt = await issueAgentToken(
      {
        appId: "authapp00001",
        cliTokenId: tokenId,
        projectId,
        scope: authorScope,
      },
      authSecret,
      env.OPENAPI_SERVER_URL!
    );
    const agentToken = {
      ...(await verifyAgentToken(jwt, authSecret, env.OPENAPI_SERVER_URL!)),
      token: jwt,
    };
    const handler = new OpenAPIHandler({ preview: previewRouter });
    const response = await handler.handle(
      new Request("https://platform.test/api/platform/preview/start", {
        body: JSON.stringify({ appId: "authapp00001", deployToken: jwt }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { context: { ...context, agentToken }, prefix: "/api/platform" }
    );
    expect(response.response!.status).toBe(200);
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    const started = (await response.response!.json()) as {
      expiresAt: string;
      sessionId: string;
      tunnelToken: string;
    };
    expect(new Date(started.expiresAt).getTime()).toBe(agentToken.exp * 1000);
    await db
      .update(cliToken)
      .set({ expiresAt: new Date(0) })
      .where(eq(cliToken.id, tokenId));
    expect(
      await authorizePreviewSocket(
        started.sessionId,
        started.tunnelToken,
        "uploader"
      )
    ).toMatchObject({ role: "uploader", sessionId: started.sessionId });
    await db
      .update(cliToken)
      .set({ revokedAt: new Date() })
      .where(eq(cliToken.id, tokenId));
    expect(
      await authorizePreviewSocket(
        started.sessionId,
        started.tunnelToken,
        "uploader"
      )
    ).toBeNull();
  });
});
