import { withAppAssetUrl } from "@patchsmith/api-utils/app-asset-url";
import type { db } from "@patchsmith/db";
import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { and, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";

type AppsDatabase = Pick<typeof db, "select" | "query">;

interface AppsListInput {
  projectId: string;
  projectShortId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  sourceAppId?: string;
}

// Installations reuse a source deployment; drafts and apps using their own
// deployments remain source apps. Names and scopes are not app identities.
const getAppsCondition = (
  projectId: string,
  search?: string,
  sourceAppId?: string
) => {
  const deploymentOwner = sql`(select ${appDeployment.appId} from ${appDeployment}
    where ${appDeployment.id} = ${app.currentDeploymentId})`;

  const kindCondition =
    sourceAppId === undefined
      ? sql`(${app.currentDeploymentId} is null or ${deploymentOwner} = ${app.id})`
      : and(ne(app.id, sourceAppId), sql`${deploymentOwner} = ${sourceAppId}`);

  const searchPattern =
    search !== undefined && search !== "" ? `%${search}%` : undefined;

  return and(
    eq(app.projectId, projectId),
    kindCondition,
    searchPattern === undefined
      ? undefined
      : or(
          ilike(app.name, searchPattern),
          ilike(app.slug, searchPattern),
          ilike(app.shortId, searchPattern),
          sql`${app.scope}::text ILIKE ${searchPattern}`,
          ilike(app.description, searchPattern),
          sql`${app.id}::text ILIKE ${searchPattern}`
        )
  );
};

export const getInstallationCounts = async (
  database: Pick<AppsDatabase, "select">,
  projectId: string,
  appIds: string[]
) =>
  await database
    .select({ appId: appDeployment.appId, value: count() })
    .from(app)
    .innerJoin(appDeployment, eq(app.currentDeploymentId, appDeployment.id))
    .where(
      and(
        eq(app.projectId, projectId),
        inArray(appDeployment.appId, appIds),
        ne(app.id, appDeployment.appId)
      )
    )
    .groupBy(appDeployment.appId);

export const listAppRecords = async (
  database: AppsDatabase,
  input: AppsListInput
) => {
  const { projectId, projectShortId, sourceAppId } = input;
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const search = input.search?.trim().toLowerCase();
  const offset = (page - 1) * pageSize;

  const where = getAppsCondition(projectId, search, sourceAppId);

  const pageItems = await database
    .select()
    .from(app)
    .where(where)
    .orderBy(desc(app.createdAt), desc(app.id))
    .limit(pageSize + 1)
    .offset(offset);

  const items = pageItems.slice(0, pageSize);

  if (items.length === 0) {
    return {
      items: [],
      pagination: {
        hasMore: false,
        page,
        pageSize,
      },
    };
  }

  const appIds = items.map((item) => item.id);

  const currentDeploymentIds = items
    .map((item) => item.currentDeploymentId)
    .filter((id): id is string => id !== null);

  const [
    deploymentCounts,
    latestDeployments,
    currentDeployments,
    installationCounts,
  ] = await Promise.all([
    database
      .select({ appId: appDeployment.appId, value: count() })
      .from(appDeployment)
      .where(inArray(appDeployment.appId, appIds))
      .groupBy(appDeployment.appId),
    database
      .select()
      .from(appDeployment)
      .where(inArray(appDeployment.appId, appIds))
      .orderBy(desc(appDeployment.createdAt)),
    currentDeploymentIds.length > 0
      ? database.query.appDeployment.findMany({
          where: { id: { in: currentDeploymentIds } },
          with: { app: { columns: { shortId: true } } },
        })
      : Promise.resolve([]),
    getInstallationCounts(database, projectId, appIds),
  ]);

  const installationCountByAppId = new Map(
    installationCounts.map((item) => [item.appId, item.value])
  );

  const deploymentCountByAppId = new Map(
    deploymentCounts.map((item) => [item.appId, item.value])
  );

  const latestDeploymentByAppId = new Map<
    string,
    (typeof latestDeployments)[number]
  >();

  for (const deployment of latestDeployments) {
    if (!latestDeploymentByAppId.has(deployment.appId)) {
      latestDeploymentByAppId.set(deployment.appId, deployment);
    }
  }

  const currentDeploymentById = new Map(
    currentDeployments.map((deployment) => [deployment.id, deployment])
  );

  return {
    items: items.map((item) => {
      const { scopeKey, ...publicApp } = item;
      void scopeKey;

      return withAppAssetUrl(
        {
          ...publicApp,
          currentDeployment:
            item.currentDeploymentId !== undefined &&
            item.currentDeploymentId !== null &&
            item.currentDeploymentId !== ""
              ? (currentDeploymentById.get(item.currentDeploymentId) ?? null)
              : null,
          deploymentCount: deploymentCountByAppId.get(item.id) ?? 0,
          installationCount: installationCountByAppId.get(item.id) ?? 0,
          latestDeployment: latestDeploymentByAppId.get(item.id) ?? null,
        },
        projectShortId
      );
    }),
    pagination: {
      hasMore: pageItems.length > pageSize,
      page,
      pageSize,
    },
  };
};
