import type { ORPCError } from "@orpc/server";
import { call } from "@orpc/server";
import {
  user,
  organization,
  member,
  invitation,
} from "@tailorkit/db/schema/index";
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
  env: {
    VERCEL_ENV: undefined as
      | "production"
      | "preview"
      | "development"
      | undefined,
  },
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
      acceptInvitation: vi.fn(),
      createOrganization: vi.fn(),
      hasPermission: vi.fn(),
      rejectInvitation: vi.fn(),
    },
  },
}));

vi.mock("#env", () => ({
  env: testState.env,
}));

const { userRouter } = await import("./user");
const { orgRouter } = await import("./org");
const { auth } = await import("@tailorkit/auth");

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const orgId = "33333333-3333-4333-8333-333333333333";
const otherOrgId = "44444444-4444-4444-8444-444444444444";

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

describe("userRouter", () => {
  let client: Awaited<ReturnType<typeof createTestDb>>["client"];
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];

  beforeEach(async () => {
    const testDb = await createTestDb();
    ({ client } = testDb);
    ({ db } = testDb);
    testState.db = db;
    testState.env.VERCEL_ENV = undefined;
    vi.mocked(auth.api.createOrganization).mockReset();

    await db.insert(user).values([
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        email: "ada@example.com",
        emailVerified: true,
        id: userId,
        name: "Ada Lovelace",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        email: "grace@example.com",
        emailVerified: true,
        id: otherUserId,
        name: "Grace Hopper",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    await db.insert(organization).values([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        id: orgId,
        name: "Analytical Engines",
        publicId: "team0000000001",
        slug: "analytical-engines",
      },
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        id: otherOrgId,
        name: "Compilers Inc",
        publicId: "team0000000002",
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
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  it("requires invitation management permission to enumerate pending invitations", async () => {
    await db.insert(invitation).values({
      email: "charles@example.com",
      expiresAt: new Date("2099-02-01T00:00:00.000Z"),
      inviterId: userId,
      organizationId: orgId,
      role: "member",
      status: "pending",
    });
    vi.mocked(auth.api.hasPermission).mockResolvedValueOnce({
      error: null,
      success: false,
    });

    await expect(
      call(
        orgRouter.getOrgInvitations,
        { orgSlug: "analytical-engines" },
        { context: createContext() }
      )
    ).rejects.toEqual(expect.objectContaining({ code: "FORBIDDEN" }));

    expect(auth.api.hasPermission).toHaveBeenCalledWith({
      body: {
        organizationId: orgId,
        permissions: { invitation: ["read"] },
      },
      headers: expect.any(Headers),
    });
  });

  it("returns the current session and user", async () => {
    const context = createContext();

    await expect(
      call(userRouter.getSession, undefined, { context })
    ).resolves.toEqual({
      session: context.session,
      user: context.user,
    });
  });

  it("requires auth for protected procedures", async () => {
    await expect(
      call(userRouter.getOrgs, undefined, {
        context: createContext({ session: null, user: null }),
      })
    ).rejects.toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("returns organizations the current user belongs to", async () => {
    const orgs = await call(userRouter.getOrgs, undefined, {
      context: createContext(),
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toEqual(
      expect.objectContaining({ id: orgId, slug: "analytical-engines" })
    );
  });

  it("resolves an organization by slug or id for the current user", async () => {
    await expect(
      call(
        userRouter.getOrg,
        { orgSlug: "analytical-engines" },
        { context: createContext() }
      )
    ).resolves.toEqual(expect.objectContaining({ id: orgId }));

    await expect(
      call(userRouter.getOrg, { orgId }, { context: createContext() })
    ).resolves.toEqual(expect.objectContaining({ slug: "analytical-engines" }));
  });

  it("does not resolve organizations outside the current user's membership", async () => {
    await expect(
      call(
        userRouter.getOrg,
        { orgSlug: "compilers-inc" },
        { context: createContext() }
      )
    ).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" } satisfies Partial<
        ORPCError<"NOT_FOUND", unknown>
      >)
    );
  });

  it("does not allow users to create organizations in production", async () => {
    testState.env.VERCEL_ENV = "production";

    await expect(
      call(
        userRouter.createOrg,
        { name: "New Org", slug: "new-org" },
        { context: createContext() }
      )
    ).rejects.toEqual(
      expect.objectContaining({ code: "FORBIDDEN" } satisfies Partial<
        ORPCError<"FORBIDDEN", unknown>
      >)
    );
  });

  it("allows users to create organizations outside production", async () => {
    testState.env.VERCEL_ENV = "development";
    vi.mocked(auth.api.createOrganization).mockResolvedValue({
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      id: "77777777-7777-4777-8777-777777777777",
      members: [],
      metadata: null,
      name: "New Org",
      publicId: "team0000000003",
      slug: "new-org",
    });

    await expect(
      call(
        userRouter.createOrg,
        { name: "New Org", slug: "new-org" },
        { context: createContext() }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        id: "77777777-7777-4777-8777-777777777777",
        slug: "new-org",
      })
    );

    expect(auth.api.createOrganization).toHaveBeenCalledWith({
      body: { name: "New Org", slug: "new-org", userId },
    });
  });

  it("returns pending unexpired invitations for the current user's email", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await db.insert(invitation).values([
      {
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        email: "ada@example.com",
        expiresAt: futureDate,
        id: "66666666-6666-4666-8666-666666666666",
        inviterId: otherUserId,
        organizationId: orgId,
        status: "pending",
      },
      {
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        email: "ada@example.com",
        expiresAt: futureDate,
        id: "77777777-7777-4777-8777-777777777777",
        inviterId: otherUserId,
        organizationId: orgId,
        status: "accepted",
      },
      {
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        email: "ada@example.com",
        expiresAt: pastDate,
        id: "88888888-8888-4888-8888-888888888888",
        inviterId: otherUserId,
        organizationId: orgId,
        status: "pending",
      },
    ]);

    const invitations = await call(
      userRouter.getPendingInvitations,
      undefined,
      {
        context: createContext(),
      }
    );

    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toEqual(
      expect.objectContaining({
        email: "ada@example.com",
        organization: expect.objectContaining({ id: orgId }),
        status: "pending",
      })
    );
  });
});
