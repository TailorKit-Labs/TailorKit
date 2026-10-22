import { db } from "@patchsmith/db";
import type { relations } from "@patchsmith/db/relations";
import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { and, eq, inArray } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core/async";

import { warmRuntimeInstallation } from "./publication";

export interface RuntimeRollout {
  projectId: string;
  appId: string;
  deploymentId: string;
}

/** The owner's row serializes competing rollouts; delayed publications are ignored. */
export const selectRuntimeDeployment = async <TResult extends PgQueryResultHKT>(
  input: RuntimeRollout,
  database: Pick<PgAsyncDatabase<TResult, typeof relations>, "transaction">
) =>
  await database.transaction(async (tx) => {
    const [owner] = await tx
      .select({ deploymentId: app.currentDeploymentId })
      .from(app)
      .where(and(eq(app.id, input.appId), eq(app.projectId, input.projectId)))
      .for("update");

    if (owner?.deploymentId !== input.deploymentId) {
      return false;
    }

    await tx
      .update(app)
      .set({ currentDeploymentId: input.deploymentId })
      .where(
        and(
          eq(app.projectId, input.projectId),
          inArray(
            app.currentDeploymentId,
            tx
              .select({ id: appDeployment.id })
              .from(appDeployment)
              .where(eq(appDeployment.appId, input.appId))
          )
        )
      );

    return true;
  });

export const listRuntimeInstallations = async (
  input: RuntimeRollout,
  cursor?: string
) => {
  "use step";
  const { gt } = await import("drizzle-orm");

  const rows = await db
    .select({ id: app.id })
    .from(app)
    .where(
      and(
        eq(app.projectId, input.projectId),
        eq(app.currentDeploymentId, input.deploymentId),
        cursor === undefined ? undefined : gt(app.id, cursor)
      )
    )
    .orderBy(app.id)
    .limit(50);

  console.info("Listed runtime installations", {
    count: rows.length,
    deploymentId: input.deploymentId,
  });

  return rows.map(({ id }) => id);
};

export const warmRuntimeDeployment = async (
  projectId: string,
  appId: string
) => {
  "use step";

  // Resolve each target afresh on retries; never post an older workflow's selection.
  const installation = await db.query.app.findFirst({
    where: { id: appId, projectId },
    with: {
      currentDeployment: {
        where: { status: "published" },
        with: { app: { columns: { shortId: true } } },
      },
    },
  });

  const deployment = installation?.currentDeployment;

  if (!installation || !deployment) {
    return;
  }

  const sourceShortId = deployment.app?.shortId;

  if (sourceShortId === undefined || sourceShortId === "") {
    throw new Error("Deployment source missing");
  }

  const project = await db.query.project.findFirst({
    columns: { shortId: true },
    where: { id: projectId },
  });

  if (!project) {
    return;
  }

  const file = await db.query.appDeploymentFile.findFirst({
    where: {
      appDeploymentId: deployment.id,
      objectKey: `projects/${project.shortId}/apps/${sourceShortId}/deployments/${deployment.shortId}/server/server.js`,
      status: "verified",
    },
  });

  if (
    file?.checksum === undefined ||
    file.checksum === null ||
    file.checksum === ""
  ) {
    return;
  }

  await warmRuntimeInstallation(
    {
      appId,
      checksum: file.checksum,
      contentEncoding: file.encoding === "gzip" ? "gzip" : undefined,
      contentLength: file.contentLength,
      deploymentId: deployment.id,
      objectKey: file.objectKey,
      projectId,
    },
    installation.shortId
  );
  console.info("Warmed runtime installation", {
    appId,
    deploymentId: deployment.id,
  });
};
