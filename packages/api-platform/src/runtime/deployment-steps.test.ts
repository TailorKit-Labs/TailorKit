import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { organization } from "@patchsmith/db/schema/auth";
import { project } from "@patchsmith/db/schema/project";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";

import { createTestDb } from "#test/pglite";

import { selectRuntimeDeployment } from "./deployment-steps";

it("rolls out every installation of the source and rejects delayed older rollouts", async () => {
  const { client, db } = await createTestDb();

  try {
    const [org] = await db
      .insert(organization)
      .values({
        createdAt: new Date(),
        name: "Runtime",
        shortId: "org000000001",
        slug: "runtime",
      })
      .returning();

    if (!org) {
      throw new Error("Organization missing");
    }

    const [workspace] = await db
      .insert(project)
      .values({ name: "Runtime", organizationId: org.id, slug: "runtime" })
      .returning();

    if (!workspace) {
      throw new Error("Project missing");
    }

    const scope = { name: "tenant", value: { id: "one" } };

    const installations = await db
      .insert(app)
      .values(
        ["source", "first", "second", "unrelated"].map((name) => ({
          name,
          projectId: workspace.id,
          scope,
          scopeKey: "tenant:one",
          slug: name,
        }))
      )

      .returning();

    const [source, first, second, unrelated] = installations;

    if (!source || !first || !second || !unrelated) {
      throw new Error("Installations missing");
    }

    const [old, next, other] = await db
      .insert(appDeployment)
      .values([
        { appId: source.id, status: "published" as const },
        { appId: source.id, status: "published" as const },
        { appId: unrelated.id, status: "published" as const },
      ])
      .returning();

    if (!old || !next || !other) {
      throw new Error("Deployments missing");
    }

    await db
      .update(app)
      .set({ currentDeploymentId: old.id })
      .where(eq(app.projectId, workspace.id));
    await db
      .update(app)
      .set({ currentDeploymentId: other.id })
      .where(eq(app.id, unrelated.id));
    await db
      .update(app)
      .set({ currentDeploymentId: next.id })
      .where(eq(app.id, source.id));

    const input = {
      appId: source.id,
      deploymentId: next.id,
      projectId: workspace.id,
    };

    expect(await selectRuntimeDeployment(input, db)).toBe(true);
    expect(
      await selectRuntimeDeployment({ ...input, deploymentId: old.id }, db)
    ).toBe(false);

    const rows = await db
      .select({ deploymentId: app.currentDeploymentId, id: app.id })
      .from(app);

    expect(new Map(rows.map((row) => [row.id, row.deploymentId]))).toEqual(
      new Map([
        [source.id, next.id],
        [first.id, next.id],
        [second.id, next.id],
        [unrelated.id, other.id],
      ])
    );
    // An explicit rollback of the owner is also a valid new rollout.
    await db
      .update(app)
      .set({ currentDeploymentId: old.id })
      .where(eq(app.id, source.id));
    expect(
      await selectRuntimeDeployment({ ...input, deploymentId: old.id }, db)
    ).toBe(true);
    expect(
      await db
        .select({ id: app.id })
        .from(app)
        .where(eq(app.currentDeploymentId, old.id))
    ).toHaveLength(3);
  } finally {
    await client.close();
  }
});
