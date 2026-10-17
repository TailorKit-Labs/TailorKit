import type { ORPCError } from "@orpc/server";
import { call } from "@orpc/server";
import { auth } from "@tailorkit/auth";
import { organization, member, user } from "@tailorkit/db/schema/auth";
import { project } from "@tailorkit/db/schema/project";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type { Context } from "#context";
import { createTestDb } from "#test/pglite";

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const testState = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock("@tailorkit/db", () => ({
  createDb: () => testState.db,
  get db() {
    return testState.db;
  },
  isOrgSlugReserved: () => false,
}));

vi.mock("@tailorkit/auth", () => ({
  auth: {
    api: {
      createApiKey: vi.fn().mockResolvedValue({
        id: "api-key-id",
        key: "tk_proj_secret",
      }),
      deleteApiKey: vi.fn(),
      hasPermission: vi.fn().mockResolvedValue({ success: true }),
      updateApiKey: vi.fn(),
    },
  },
}));

const { projectRouter } = await import("./project");

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const otherOrgId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";

const createContext = (overrides: Partial<Context> = {}): Context => ({
  headers: new Headers(),
  ip: "127.0.0.1",
  session: {
    activeOrganizationId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    id: "session-id",
    ipAddress: null,
    token: "session-token",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userAgent: null,
    userId,
  },
  user: {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    email: "ada@example.com",
    emailVerified: true,
    id: userId,
    image: null,
    name: "Ada Lovelace",
    theme: "system",
    twoFactorEnabled: false,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  ...overrides,
});

describe("projectRouter", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    const testDb = await createTestDb();
    ({ client } = testDb);
    ({ db } = testDb);
    testState.db = db;

    await db.insert(user).values({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      email: "ada@example.com",
      emailVerified: true,
      id: userId,
      name: "Ada Lovelace",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await db.insert(organization).values([
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: orgId,
        name: "Analytical Engines",
        shortId: "team00000001",
        slug: "analytical-engines",
      },
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: otherOrgId,
        name: "Compilers Inc",
        shortId: "team00000002",
        slug: "compilers-inc",
      },
    ]);

    await db.insert(member).values({
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      id: "55555555-5555-4555-8555-555555555555",
      organizationId: orgId,
      role: "owner",
      userId,
    });

    await db.insert(project).values([
      {
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        id: projectId,
        name: "Compiler",
        organizationId: orgId,
        slug: "compiler",
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
      {
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        name: "Runtime",
        organizationId: otherOrgId,
        slug: "runtime",
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("lists projects only for organizations the user belongs to", async () => {
    const projects = await call(
      projectRouter.list,
      { orgSlug: "analytical-engines" },
      { context: createContext() }
    );

    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(
      expect.objectContaining({ id: projectId, slug: "compiler" })
    );
  });

  it("rejects projects in organizations outside the current user's membership", async () => {
    await expect(
      call(
        projectRouter.list,
        { orgSlug: "compilers-inc" },
        { context: createContext() }
      )
    ).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" } satisfies Partial<
        ORPCError<"NOT_FOUND", unknown>
      >)
    );
  });

  it("validates duplicate project slugs within an organization", async () => {
    await expect(
      call(
        projectRouter.create,
        {
          name: "Compiler Two",
          orgSlug: "analytical-engines",
          slug: "compiler",
        },
        { context: createContext() }
      )
    ).rejects.toEqual(
      expect.objectContaining({ code: "BAD_REQUEST" } satisfies Partial<
        ORPCError<"BAD_REQUEST", unknown>
      >)
    );
  });

  it("creates reusable host project API keys from the server auth instance", async () => {
    await call(
      projectRouter.create,
      { name: "Analyzer", orgSlug: "analytical-engines", slug: "analyzer" },
      { context: createContext() }
    );

    const expectedBodyMatcher1: unknown = expect.objectContaining({
      configId: "project-host",
      userId,
    });
    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expectedBodyMatcher1,
    });
  });

  it("uses a high backstop rate limit on host project API keys", async () => {
    await call(
      projectRouter.create,
      { name: "Analyzer", orgSlug: "analytical-engines", slug: "analyzer" },
      { context: createContext() }
    );

    const expectedBodyMatcher2: unknown = expect.objectContaining({
      configId: "project-host",
      rateLimitEnabled: true,
      rateLimitMax: 1000,
      rateLimitTimeWindow: 1000,
    });
    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expectedBodyMatcher2,
    });
  });

  it("uses a stable generated API key name independent of project names", async () => {
    await call(
      projectRouter.create,
      {
        name: "A very long project name that should still be allowed",
        orgSlug: "analytical-engines",
        slug: "long-project-name",
      },
      { context: createContext() }
    );

    const expectedBodyMatcher3: unknown = expect.objectContaining({
      name: "Project host key",
    });
    expect(auth.api.createApiKey).toHaveBeenCalledWith({
      body: expectedBodyMatcher3,
    });
  });
});
