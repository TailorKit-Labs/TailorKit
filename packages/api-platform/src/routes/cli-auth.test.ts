import { call } from "@orpc/server";
import { organization } from "@tailorkit/db/schema/auth";
import { cliAuthSession, cliToken } from "@tailorkit/db/schema/cli-auth";
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

import { env } from "#env";

import type { Context } from "../context";
import { createTestDb } from "../test/pglite";

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const testState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@tailorkit/db", () => ({
  createDb: () => testState.db,
  get db() {
    return testState.db;
  },
}));

const { cliAuthRouter } = await import("./cli-auth");

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const scope = {
  name: "user",
  value: { organizationId: "org_123", userId: "user_456" },
};
const expectedScope = {
  name: "user",
  value: { organizationId: "org_123", userId: "user_456" },
};
const expectedScopeKey = "83f6cbb3372e91fda7451be1728a9e91";

const createContext = (): Context => ({
  organization: {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: organizationId,
    logo: null,
    metadata: null,
    name: "Analytical Engines",
    publicId: "team0000000001",
    slug: "analytical-engines",
  },
  project: {
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    id: projectId,
    name: "Compiler",
    organizationId,
    slug: "compiler",
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  storage: {
    createDownloadUrl: vi.fn(),
    createUploadUrl: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    type: "s3",
  },
});

describe("platform CLI auth scopes", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    if (!env.AUTH_SECRET) {
      throw new Error(
        "The CLI auth test requires AUTH_SECRET in its Vitest config."
      );
    }
    const testDb = await createTestDb();
    ({ client } = testDb);
    ({ db } = testDb);
    testState.db = db;

    await db.insert(organization).values({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      id: organizationId,
      name: "Analytical Engines",
      publicId: "team0000000001",
      slug: "analytical-engines",
    });
    await db.insert(projectTable).values({
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      id: projectId,
      name: "Compiler",
      organizationId,
      slug: "compiler",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("stores and returns the exact structured scope when issuing a CLI token", async () => {
    const context = createContext();
    const started = await call(cliAuthRouter.start, { body: {} }, { context });
    await call(
      cliAuthRouter.approve,
      { body: { scope, userCode: started.body.userCode } },
      { context }
    );

    const polled = await call(
      cliAuthRouter.poll,
      { body: { deviceCode: started.body.deviceCode } },
      { context }
    );
    if (polled.body.status !== "approved") {
      throw new Error("Expected CLI auth session to be approved.");
    }
    expect(polled.body).toEqual({
      deployToken: expect.any(String),
      scope: expectedScope,
      status: "approved",
    });

    const verified = await call(
      cliAuthRouter.verifyToken,
      { body: { deployToken: polled.body.deployToken } },
      { context }
    );
    expect(verified.body).toEqual({ scope: expectedScope });

    const token = await db.query.cliToken.findFirst();
    expect(token).toEqual(
      expect.objectContaining({
        lastUsedAt: expect.any(Date),
        scope: expectedScope,
        scopeKey: expectedScopeKey,
      })
    );
  });

  it("rejects malformed stored scopes in approved sessions and deploy tokens", async () => {
    const context = createContext();
    const started = await call(cliAuthRouter.start, { body: {} }, { context });
    await call(
      cliAuthRouter.approve,
      { body: { scope, userCode: started.body.userCode } },
      { context }
    );
    const session = await db.query.cliAuthSession.findFirst();
    if (!session) {
      throw new Error("Expected CLI auth session.");
    }
    await db
      .update(cliAuthSession)
      .set({ scope: { name: "user", value: {} } })
      .where(eq(cliAuthSession.id, session.id));
    await expect(
      call(
        cliAuthRouter.poll,
        { body: { deviceCode: started.body.deviceCode } },
        { context }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db
      .update(cliAuthSession)
      .set({ scope: expectedScope, scopeKey: "0".repeat(32) })
      .where(eq(cliAuthSession.id, session.id));
    await expect(
      call(
        cliAuthRouter.poll,
        { body: { deviceCode: started.body.deviceCode } },
        { context }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db
      .update(cliAuthSession)
      .set({ scope: expectedScope, scopeKey: expectedScopeKey })
      .where(eq(cliAuthSession.id, session.id));
    const polled = await call(
      cliAuthRouter.poll,
      { body: { deviceCode: started.body.deviceCode } },
      { context }
    );
    if (polled.body.status !== "approved") {
      throw new Error("Expected approved CLI token.");
    }
    const token = await db.query.cliToken.findFirst();
    if (!token) {
      throw new Error("Expected CLI token.");
    }
    await db
      .update(cliToken)
      .set({ scope: { name: "user", value: {} } })
      .where(eq(cliToken.id, token.id));
    await expect(
      call(
        cliAuthRouter.verifyToken,
        { body: { deployToken: polled.body.deployToken } },
        { context }
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await db
      .update(cliToken)
      .set({ scope: expectedScope, scopeKey: "0".repeat(32) })
      .where(eq(cliToken.id, token.id));
    await expect(
      call(
        cliAuthRouter.verifyToken,
        { body: { deployToken: polled.body.deployToken } },
        { context }
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
