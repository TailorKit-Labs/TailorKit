import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { issueAgentToken } from "@tailorkit/api-utils/agent-token";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { app, appDeployment } from "@tailorkit/db/schema/apps";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { organization } from "@tailorkit/db/schema/auth";
import { project } from "@tailorkit/db/schema/project";
import { env } from "#env";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createTestDb } from "../test/pglite";
import { canonicalizeScope } from "../scope";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  apiKey: vi.fn(),
  storage: {
    type: "s3",
    createUploadUrl: vi.fn(),
    createDownloadUrl: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return mocks.db;
  },
}));
vi.mock("@tailorkit/auth", () => ({ auth: { api: { verifyApiKey: mocks.apiKey } } }));
vi.mock("@tailorkit/storage", () => ({ getStorage: () => mocks.storage }));
vi.mock("@tailorkit/kv", () => ({ getKV: () => null }));

const { createContext, contextErrorResponse } = await import("../context");
const { appRouter } = await import("./apps");
const { deploymentRouter } = await import("./deployments");
const { cliAuthRouter } = await import("./cli-auth");
const handler = new OpenAPIHandler({
  apps: appRouter,
  deployments: deploymentRouter,
  cliAuth: cliAuthRouter,
});
const projectId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const tokenSecret = "issued-cli-token";
const scope = canonicalizeScope({ name: "user", value: { userId: "user-one" } });
let database: Awaited<ReturnType<typeof createTestDb>>;
let jwt: string;
let sourceTokenId: string;
let authorizedAppId: string;
let sameScopeAppId: string;
let otherScopeAppId: string;
let otherProjectAppId: string;

function request(path: string, body: unknown = {}, secret = jwt) {
  return new Request(`https://platform.test/api/platform${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(path: string, body: unknown = {}) {
  const input = request(path, body);
  let context;
  try {
    context = await createContext({ request: input });
  } catch (error) {
    const response = contextErrorResponse(error);
    return { status: response.status, body: await response.json() };
  }
  const result = await handler.handle(input, { prefix: "/api/platform", context });
  if (!result.response) throw new Error("Expected HTTP response");
  return { status: result.response.status, body: await result.response.json() };
}
const deploymentInput = (appId: string) => ({
  appId,
  scope: scope.scope,
  assets: [
    {
      checksum: "a".repeat(64),
      contentLength: 10,
      contentType: "application/javascript",
      encoding: "gzip",
      objectKey: "client.js",
    },
  ],
});

beforeEach(async () => {
  vi.clearAllMocks();
  database = await createTestDb();
  mocks.db = database.db;
  const db = database.db;
  await db.insert(organization).values({
    id: organizationId,
    publicId: "team0000000001",
    name: "Team",
    slug: "team",
    createdAt: new Date(),
  });
  const otherProjectId = "33333333-3333-4333-8333-333333333333";
  await db.insert(project).values([
    { id: projectId, organizationId, name: "Project", slug: "project" },
    { id: otherProjectId, organizationId, name: "Other", slug: "other" },
  ]);
  const [source] = await db
    .insert(cliToken)
    .values({
      projectId,
      ...scope,
      tokenHash: hashSecret(tokenSecret, env.AUTH_SECRET!),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  sourceTokenId = source!.id;
  const apps = await db
    .insert(app)
    .values([
      { projectId, ...scope, name: "Allowed", publicId: "app000000001" },
      { projectId, ...scope, name: "Same scope", publicId: "app000000004" },
      {
        projectId,
        ...canonicalizeScope({ name: "user", value: { userId: "user-two" } }),
        name: "Other scope",
        publicId: "app000000002",
      },
      { projectId: otherProjectId, ...scope, name: "Other project", publicId: "app000000003" },
    ])
    .returning();
  authorizedAppId = apps[0]!.id;
  sameScopeAppId = apps[1]!.id;
  otherScopeAppId = apps[2]!.id;
  otherProjectAppId = apps[3]!.id;
  jwt = await issueAgentToken(
    { projectId, appId: authorizedAppId, cliTokenId: sourceTokenId, scope: scope.scope },
    env.AUTH_SECRET!,
    env.OPENAPI_SERVER_URL!,
  );
  mocks.storage.createUploadUrl.mockResolvedValue({ uploadUrl: "https://uploads.test/client.js" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await database.client.close();
});

it("deploys with an agent JWT through the existing endpoint without a host key", async () => {
  const created = await post("/deployments", deploymentInput(authorizedAppId));
  expect(created.status).toBe(200);
  expect(created.body.deployment).toMatchObject({ appId: authorizedAppId, status: "uploading" });
  expect(mocks.apiKey).not.toHaveBeenCalled();
});

it("keeps the one-hour grant valid after the source CLI token expires", async () => {
  await database.db.update(cliToken).set({ expiresAt: new Date(0) });
  expect((await post("/deployments", deploymentInput(authorizedAppId))).status).toBe(200);
});

it.each(["expired", "revoked", "invalid", "malformed-scope"])(
  "rejects %s agent credentials",
  async (state) => {
    if (state === "expired") {
      vi.useFakeTimers();
      vi.advanceTimersByTime(3600_000);
    }
    if (state === "revoked") await database.db.update(cliToken).set({ revokedAt: new Date() });
    if (state === "malformed-scope")
      await database.db.update(cliToken).set({ scopeKey: "0".repeat(32) });
    if (state === "invalid") jwt = jwt.slice(0, jwt.lastIndexOf(".") + 1) + "invalid";
    expect(await post("/deployments", deploymentInput(authorizedAppId))).toMatchObject({
      status: 401,
      body: { code: "UNAUTHORIZED" },
    });
  },
);

it("cannot change the authorized scope", async () => {
  expect(
    await post("/deployments", {
      ...deploymentInput(authorizedAppId),
      scope: {
        name: "user",
        value: { userId: "user-two" },
      },
    }),
  ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
});

it("rejects apps outside the scope or project", async () => {
  for (const appId of [otherScopeAppId, otherProjectAppId]) {
    expect(await post("/deployments", deploymentInput(appId))).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
    const [deployment] = await database.db
      .insert(appDeployment)
      .values({
        appId,
        publicId: appId.slice(0, 12),
        status: "uploading",
      })
      .returning();
    expect(await post(`/deployments/${deployment!.id}`, { scope: scope.scope })).toMatchObject({
      status: 404,
      body: { code: "NOT_FOUND" },
    });
  }
});

it("keeps ordinary CLI tokens on the host authentication path", async () => {
  await expect(
    createContext({ request: request("/deployments", {}, tokenSecret) }),
  ).rejects.toThrow("Invalid API key");
  expect(mocks.apiKey).toHaveBeenCalled();
});

it("publishes a verified upload to the authorized app", async () => {
  const created = await post("/deployments", deploymentInput(authorizedAppId));
  mocks.storage.head.mockResolvedValue({
    contentLength: 10,
    contentType: "application/javascript",
    contentEncoding: "gzip",
    checksumSha256: Buffer.from("a".repeat(64), "hex").toString("base64"),
  });
  mocks.storage.createDownloadUrl.mockResolvedValue({ url: "https://uploads.test/client.js" });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("client-code"));
  const published = await post(`/deployments/${created.body.deployment.id}`, {
    rollout: true,
    scope: scope.scope,
  });
  expect(published).toMatchObject({ status: 200, body: { status: "published" } });
  const selectedApp = await database.db.query.app.findFirst({ where: { id: authorizedAppId } });
  expect(selectedApp?.currentDeploymentId).toBe(created.body.deployment.id);
  const otherApp = await database.db.query.app.findFirst({ where: { id: otherScopeAppId } });
  expect(otherApp?.currentDeploymentId).toBeNull();
});

it("uses the same CLI permissions for verification, listing, app creation, and deployment", async () => {
  expect(await post("/cli-auth/verify-token", { deployToken: jwt })).toMatchObject({
    status: 200,
    body: { scope: scope.scope },
  });
  expect(await post("/apps/list", { scopes: [scope.scope] })).toMatchObject({ status: 200 });
  const created = await post("/apps", { name: "New app", description: null, scope: scope.scope });
  expect(created).toMatchObject({ status: 200, body: { scope: scope.scope } });
  expect((await post(`/apps/${sameScopeAppId}/lookup`, { scopes: [scope.scope] })).status).toBe(
    200,
  );
  expect((await post("/deployments", deploymentInput(sameScopeAppId))).status).toBe(200);
  expect((await post("/deployments", deploymentInput(created.body.id))).status).toBe(200);
});

it("reports database outages as 503 rather than rejecting a valid JWT", async () => {
  vi.spyOn(database.db.query.cliToken, "findFirst").mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  expect(await post("/deployments", deploymentInput(authorizedAppId))).toEqual({
    status: 503,
    body: { code: "SERVICE_UNAVAILABLE", message: "Platform is temporarily unavailable." },
  });
});

it("maps missing credentials to 401 and unavailable dependencies to 503", () => {
  expect(contextErrorResponse(new Error("storage unavailable")).status).toBe(503);
});

it("keeps runtime-only metadata private from CLI credentials", async () => {
  const { getRuntimeBundle } = await import("./runtime");
  const input = request(`/apps/${authorizedAppId}/runtime`);
  const context = await createContext({ request: input });
  const result = await new OpenAPIHandler({ runtime: getRuntimeBundle }).handle(input, {
    prefix: "/api/platform",
    context,
  });
  expect(result.response!.status).toBe(403);
});

it("validates all supplied scope selectors rather than accepting an authorized decoy", async () => {
  expect(
    await post("/apps/list", {
      scope: scope.scope,
      scopes: [{ name: "user", value: { userId: "user-two" } }],
    }),
  ).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
});
