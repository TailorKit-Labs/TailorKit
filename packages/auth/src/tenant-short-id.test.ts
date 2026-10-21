import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins/organization";
import { describe, expect, it } from "vite-plus/test";

import {
  initializeTenantShortId,
  tenantShortIdField,
} from "./lib/tenant-short-id";

const shortIdPattern = /^[a-z0-9]{12}$/u;

const createTestAuth = () =>
  betterAuth({
    baseURL: "https://patchsmith.io",
    database: memoryAdapter({ organization: [] }),
    plugins: [
      organization({
        schema: {
          organization: {
            additionalFields: { shortId: tenantShortIdField },
          },
        },
      }),
    ],
    secret: "test-secret-with-at-least-32-characters",
  });

describe("tenant short IDs", () => {
  it("generates distinct IDs for adapter creates without organization-hook fields", async () => {
    const { adapter } = await createTestAuth().$context;

    const data = {
      createdAt: new Date(),
      name: "Dashboard organization",
      slug: "dashboard-organization",
    };

    // Dash can strip input:false fields after calling the organization hook.
    // Exercise the real adapter with the resulting missing shortId.
    const first = await adapter.create({ data, model: "organization" });

    const second = await adapter.create({
      data: { ...data, slug: "another-organization" },
      model: "organization",
    });

    expect(first.shortId).toMatch(shortIdPattern);
    expect(second.shortId).toMatch(shortIdPattern);
    expect(second.shortId).not.toBe(first.shortId);
  });

  it("preserves the hook-generated identity while replacing caller-supplied IDs", async () => {
    const { adapter } = await createTestAuth().$context;

    const { data } = initializeTenantShortId({
      name: "Server-created organization",
      shortId: "caller-supplied",
      slug: "server-created-organization",
    });

    const created = await adapter.create({
      data: { ...data, createdAt: new Date() },
      model: "organization",
    });

    expect(data.shortId).toMatch(shortIdPattern);
    expect(data.shortId).not.toBe("caller-supplied");
    expect(created.shortId).toBe(data.shortId);
  });
});
