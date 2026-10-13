import { createHmac } from "node:crypto";

import { user } from "@tailorkit/db/schema/auth";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { createTestDb } from "./test/pglite";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@tailorkit/db", () => ({ createDb: () => state.db }));
vi.mock("@tailorkit/kv", () => ({ getKV: () => null }));
vi.mock("@tailorkit/observability", () => ({
  initializeObservability: vi.fn(),
}));
vi.mock("@tailorkit/email", () => ({
  sendBetterAuthOtpEmail: vi.fn(),
  sendOrganizationInvitationEmail: vi.fn(),
}));

const fixture = await createTestDb();
state.db = fixture.db;
const { createAuth } = await import("@tailorkit/auth");
const auth = createAuth();
afterAll(async () => {
  await fixture.client.close();
});

describe("Better Auth public team identity", () => {
  it("creates the public ID through the organization hook and protects it during authenticated renames", async () => {
    const userId = "66666666-6666-4666-8666-666666666666";
    await fixture.db.insert(user).values({
      email: "owner@example.test",
      emailVerified: true,
      id: userId,
      name: "Owner",
    });
    const body = {
      name: "Original",
      publicId: "attacker00",
      slug: "original",
      userId,
    };
    const created = await auth.api.createOrganization({ body });
    expect(created?.publicId).toMatch(/^[a-z0-9][a-z0-9-]{12}[a-z0-9]$/u);
    expect(created?.publicId).not.toBe("attacker00");
    if (!created) {
      throw new Error("Organization not created");
    }
    const context = await auth.$context;
    const session = await context.internalAdapter.createSession(userId);
    if (!session) {
      throw new Error("Session not created");
    }
    const signature = createHmac("sha256", "test-auth-secret-test-auth-secret")
      .update(session.token)
      .digest("base64");
    const headers = new Headers({
      cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
      origin: "http://localhost:3000",
    });
    const updated = await auth.api.updateOrganization({
      body: {
        data: { name: "Renamed", slug: "renamed" },
        organizationId: created.id,
      },
      headers,
    });
    expect(updated?.publicId).toBe(created.publicId);
    expect(updated?.slug).toBe("renamed");
    // Exercise the real HTTP input schema, not just the TypeScript input type.
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/organization/update", {
        body: JSON.stringify({
          organizationId: created.id,
          data: { name: "HTTP rename", publicId: "attacker00" },
        }),
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    // Better Auth strips input:false fields while allowing ordinary edits.
    expect(response.status).toBe(200);
    const persisted = await fixture.db.query.organization.findFirst({
      where: { id: created.id },
    });
    expect(persisted?.publicId).toBe(created.publicId);
    expect(persisted?.name).toBe("HTTP rename");
  });
});
