import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { organization } from "@patchsmith/db/schema/auth";
import { project } from "@patchsmith/db/schema/project";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createTestDb } from "#test/pglite";

import { getInstallationCounts, listAppRecords } from "./app-list";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const projectShortId = "project00001";
const listInput = { projectId, projectShortId };

describe("app catalog queries", () => {
  let database: Awaited<ReturnType<typeof createTestDb>>;
  let source: typeof app.$inferSelect;
  let draft: typeof app.$inferSelect;
  let olderDeployment: typeof appDeployment.$inferSelect;
  let currentDeployment: typeof appDeployment.$inferSelect;

  beforeEach(async () => {
    database = await createTestDb();
    const { db } = database;

    const [org] = await db
      .insert(organization)
      .values({
        createdAt: new Date(),
        name: "Test organization",
        shortId: "team00000001",
        slug: "test-org",
      })
      .returning();

    if (!org) {
      throw new Error("Failed to create test organization.");
    }

    await db.insert(project).values([
      {
        id: projectId,
        name: "Project",
        organizationId: org.id,
        shortId: projectShortId,
        slug: "project",
      },
      {
        id: otherProjectId,
        name: "Other",
        organizationId: org.id,
        shortId: "project00002",
        slug: "other",
      },
    ]);

    const records = await db
      .insert(app)
      .values([
        {
          createdAt: new Date("2026-01-01"),
          name: "Notes",
          projectId,
          scope: { name: "team", value: { teamId: "authors" } },
          scopeKey: "a".repeat(32),
          shortId: "source000001",
          slug: "notes",
        },
        {
          createdAt: new Date("2026-01-02"),
          name: "Notes",
          projectId,
          scope: { name: "team", value: { teamId: "draft" } },
          scopeKey: "b".repeat(32),
          shortId: "draft0000001",
          slug: "draft-notes",
        },
      ])
      .returning();

    const [createdSource, createdDraft] = records;

    if (!createdSource || !createdDraft) {
      throw new Error("Failed to create test apps.");
    }

    source = createdSource;
    draft = createdDraft;

    const [older, current] = await db
      .insert(appDeployment)
      .values([
        {
          appId: source.id,
          createdAt: new Date("2026-01-03"),
          shortId: "deploy000001",
          status: "published",
        },
        {
          appId: source.id,
          createdAt: new Date("2026-01-04"),
          shortId: "deploy000002",
          status: "published",
        },
      ])
      .returning();

    if (!older || !current) {
      throw new Error("Failed to create test deployments.");
    }

    olderDeployment = older;
    currentDeployment = current;

    await db
      .update(app)
      .set({ currentDeploymentId: current.id })
      .where(eq(app.id, source.id));
    await db.insert(app).values([
      {
        createdAt: new Date("2026-01-05"),
        currentDeploymentId: older.id,
        name: "Renamed install",
        projectId,
        scope: { name: "team", value: { teamId: "customer-one" } },
        scopeKey: "c".repeat(32),
        shortId: "install00001",
        slug: "customer-notes",
      },
      {
        createdAt: new Date("2026-01-05"),
        currentDeploymentId: current.id,
        name: "Notes",
        projectId,
        scope: { name: "team", value: { teamId: "customer-two" } },
        scopeKey: "d".repeat(32),
        shortId: "install00002",
        slug: "second-notes",
      },
      {
        name: "Other project",
        projectId: otherProjectId,
        scope: { name: "team", value: { teamId: "other" } },
        scopeKey: "e".repeat(32),
        shortId: "other0000001",
        slug: "other-notes",
      },
    ]);
  });

  afterEach(async () => {
    await database.client.close();
  });

  it("lists source apps and drafts independently of names, with counts across all source deployments", async () => {
    const result = await listAppRecords(database.db, listInput);

    expect(result.items.map((item) => item.id)).toEqual([draft.id, source.id]);
    expect(result.items).toEqual([
      expect.objectContaining({
        currentDeployment: null,
        installationCount: 0,
      }),
      expect.objectContaining({
        deploymentCount: 2,
        installationCount: 2,
      }),
    ]);
    expect(result.items[1]?.currentDeployment?.id).toBe(currentDeployment.id);
    expect(result.items.every((item) => !("scopeKey" in item))).toBe(true);
  });

  it("filters installations before pagination and keeps draft apps on their own page", async () => {
    const first = await listAppRecords(database.db, {
      ...listInput,
      pageSize: 1,
    });

    const second = await listAppRecords(database.db, {
      ...listInput,
      page: 2,
      pageSize: 1,
    });

    const third = await listAppRecords(database.db, {
      ...listInput,
      page: 3,
      pageSize: 1,
    });

    expect(first.items.map((item) => item.id)).toEqual([draft.id]);
    expect(first.pagination.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual([source.id]);
    expect(second.pagination.hasMore).toBe(false);
    expect(third.items).toEqual([]);
  });

  it("lists installations pinned to older deployments and retains their own scope and the source artifact identity", async () => {
    const result = await listAppRecords(database.db, {
      ...listInput,
      sourceAppId: source.id,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.currentDeployment?.id)).toEqual(
      expect.arrayContaining([olderDeployment.id, currentDeployment.id])
    );
    expect(
      result.items.every(
        (item) => item.currentDeployment?.app?.shortId === source.shortId
      )
    ).toBe(true);
    expect(result.items.find((item) => item.slug === "customer-notes")).toEqual(
      expect.objectContaining({
        name: "Renamed install",
        scope: { name: "team", value: { teamId: "customer-one" } },
      })
    );
    expect(
      await listAppRecords(database.db, { ...listInput, sourceAppId: draft.id })
    ).toEqual(expect.objectContaining({ items: [] }));
  });

  it("searches within the selected level by slug, scope, and name", async () => {
    const catalogSearch = await listAppRecords(database.db, {
      ...listInput,
      search: "customer",
    });

    const slugSearch = await listAppRecords(database.db, {
      ...listInput,
      search: " DRAFT-NOTES ",
    });

    const installationSearch = await listAppRecords(database.db, {
      ...listInput,
      search: "customer-one",
      sourceAppId: source.id,
    });

    expect(catalogSearch.items).toEqual([]);
    expect(slugSearch.items.map((item) => item.id)).toEqual([draft.id]);
    expect(installationSearch.items.map((item) => item.slug)).toEqual([
      "customer-notes",
    ]);
  });

  it("paginates installations with a stable order even when creation times match", async () => {
    const first = await listAppRecords(database.db, {
      ...listInput,
      pageSize: 1,
      sourceAppId: source.id,
    });

    const second = await listAppRecords(database.db, {
      ...listInput,
      page: 2,
      pageSize: 1,
      sourceAppId: source.id,
    });

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    expect(first.pagination.hasMore).toBe(true);
    expect(second.pagination.hasMore).toBe(false);
  });

  it("isolates installation counts and lists by project, including a foreign deployment reference", async () => {
    await database.db
      .update(app)
      .set({ currentDeploymentId: currentDeployment.id })
      .where(eq(app.shortId, "other0000001"));

    const counts = await getInstallationCounts(database.db, projectId, [
      source.id,
    ]);

    const foreignSource = await listAppRecords(database.db, {
      ...listInput,
      projectId: otherProjectId,
      sourceAppId: draft.id,
    });

    const result = await listAppRecords(database.db, {
      ...listInput,
      sourceAppId: source.id,
    });

    expect(counts).toEqual([{ appId: source.id, value: 2 }]);
    expect(result.items).toHaveLength(2);
    expect(foreignSource.items).toEqual([]);
  });
});
