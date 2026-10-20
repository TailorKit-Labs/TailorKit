import {
  initializeTenantShortId,
  tenantShortIdField,
} from "@patchsmith/auth/lib/tenant-short-id";
import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { organization } from "@patchsmith/db/schema/auth";
import { project } from "@patchsmith/db/schema/project";
import { afterAll, expect, it } from "vite-plus/test";

import { forEachSequential } from "#for-each-sequential";
import { createTestDb } from "#test/pglite";

const { db, client } = await createTestDb();
afterAll(async () => {
  await client.close();
});

it("keeps tenant short IDs host-controlled", () => {
  expect(tenantShortIdField).toMatchObject({
    input: false,
    required: true,
    unique: true,
  });
  const created = initializeTenantShortId({
    name: "Tenant",
    shortId: "attacker",
    slug: "editable",
  });
  expect(created.data.shortId).toMatch(/^[a-z0-9]{12}$/u);
  expect(created.data.slug).toBe("editable");
});

it("enforces the global and scoped short-ID namespaces while retaining UUID relationships", async () => {
  const [tenant] = await db
    .insert(organization)
    .values({
      createdAt: new Date(),
      name: "One",
      shortId: "tenant000001",
      slug: "one",
    })
    .returning();
  const [otherTenant] = await db
    .insert(organization)
    .values({
      createdAt: new Date(),
      name: "Two",
      shortId: "tenant000002",
      slug: "two",
    })
    .returning();
  if (!tenant || !otherTenant) {
    throw new Error("Missing tenant");
  }
  await expect(
    db.insert(organization).values({
      createdAt: new Date(),
      name: "Duplicate",
      shortId: tenant.shortId,
      slug: "duplicate",
    })
  ).rejects.toThrow();
  const [firstProject] = await db
    .insert(project)
    .values({ name: "One", organizationId: tenant.id, slug: "one" })
    .returning();
  const [secondProject] = await db
    .insert(project)
    .values({ name: "Two", organizationId: otherTenant.id, slug: "two" })
    .returning();
  if (!firstProject || !secondProject) {
    throw new Error("Missing project");
  }
  expect(firstProject.shortId).toMatch(/^[a-z0-9]{12}$/u);
  await expect(
    db.insert(project).values({
      name: "Duplicate",
      organizationId: otherTenant.id,
      shortId: firstProject.shortId,
      slug: "duplicate",
    })
  ).rejects.toThrow();
  const scope = { name: "environment", value: { environment: "production" } };
  const fields = {
    name: "App",
    scope,
    scopeKey: "production",
    shortId: "app000000001",
  };
  const [firstApp] = await db
    .insert(app)
    .values({ ...fields, projectId: firstProject.id })
    .returning();
  const [secondApp] = await db
    .insert(app)
    .values({ ...fields, projectId: secondProject.id })
    .returning();
  if (!firstApp || !secondApp) {
    throw new Error("Missing app");
  }
  expect(firstApp.id).not.toBe(secondApp.id);
  await expect(
    db
      .insert(app)
      .values({ ...fields, projectId: firstProject.id, scopeKey: "staging" })
  ).rejects.toThrow();
  await db.insert(appDeployment).values([
    { appId: firstApp.id, shortId: "deploy000001" },
    { appId: secondApp.id, shortId: "deploy000001" },
  ]);
  await expect(
    db
      .insert(appDeployment)
      .values({ appId: firstApp.id, shortId: "deploy000001" })
  ).rejects.toThrow();
  const [generatedApp] = await db
    .insert(app)
    .values({
      name: "Generated",
      projectId: firstProject.id,
      scope,
      scopeKey: "generated",
    })
    .returning();
  if (!generatedApp) {
    throw new Error("Missing generated app");
  }
  const [deployment] = await db
    .insert(appDeployment)
    .values({ appId: generatedApp.id })
    .returning();
  expect(generatedApp.shortId).toMatch(/^[a-z0-9]{12}$/u);
  expect(deployment?.shortId).toMatch(/^[a-z0-9]{12}$/u);
  await forEachSequential(
    ["organization", "project", "app", "app_deployment"],
    async (table) => {
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM ${table} ORDER BY id LIMIT 1`
      );
      const id = existing[0]?.id;
      if (id === undefined) {
        throw new Error(`Missing ${table} row`);
      }
      const { rows: updated } = await client.query<{
        id: string;
        short_id: string;
      }>(
        `UPDATE ${table} SET short_id = $1 WHERE id = $2 RETURNING id, short_id`,
        ["changed00001", id]
      );
      expect(updated).toEqual([{ id, short_id: "changed00001" }]);
    }
  );
  const { rows: renamed } = await client.query<{ id: string; slug: string }>(
    "UPDATE app SET slug = $1 WHERE id = $2 RETURNING id, slug",
    ["renamed-app", generatedApp.id]
  );
  expect(renamed).toEqual([{ id: generatedApp.id, slug: "renamed-app" }]);
  await Array.fromAsync(
    ["short", "UPPERCASE001", "abc-defghijk", "0123456789012"],
    async (invalid) => {
      await expect(
        db.insert(project).values({
          name: "Invalid",
          organizationId: tenant.id,
          shortId: invalid,
          slug: invalid,
        })
      ).rejects.toThrow();
      await expect(
        db
          .insert(app)
          .values({ ...fields, projectId: firstProject.id, shortId: invalid })
      ).rejects.toThrow();
      await expect(
        db
          .insert(appDeployment)
          .values({ appId: firstApp.id, shortId: invalid })
      ).rejects.toThrow();
      await expect(
        db.insert(organization).values({
          createdAt: new Date(),
          name: "Invalid",
          shortId: invalid,
          slug: invalid,
        })
      ).rejects.toThrow();
    }
  );
});
