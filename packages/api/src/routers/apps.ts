import { ORPCError } from "@orpc/server";
import { withAppAssetUrl } from "@tailorkit/api-utils/app-asset-url";
import {
  AppAgentWorkspaceBusyError,
  exportAppAgentWorkspace,
  getAppAgentWorkspaceStatus,
} from "@tailorkit/app-agent/source-export";
import { db } from "@tailorkit/db";
import { app, appDeployment } from "@tailorkit/db/schema/apps";
import { evaluateBooleanFlag } from "@tailorkit/flags";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, requireProject } from "#procedures";

const projectInput = z.object({
  orgSlug: z.string(),
  projectSlug: z.string(),
});

const paginationInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
});

const appInput = projectInput.extend({
  appId: z.string(),
});

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const getProjectApp = async (projectId: string, appId: string) => {
  const appByPublicId = await db.query.app.findFirst({
    where: {
      projectId,
      publicId: appId,
    },
  });

  if (appByPublicId || !uuidPattern.test(appId)) {
    return appByPublicId ?? null;
  }

  return (
    (await db.query.app.findFirst({
      where: {
        id: appId,
        projectId,
      },
    })) ?? null
  );
};

const getSourceExportApp = async (
  projectId: string,
  appId: string,
  user: { id: string; email: string }
) => {
  const selectedApp = await getProjectApp(projectId, appId);
  if (!selectedApp) {
    throw new ORPCError("NOT_FOUND", { message: "App not found." });
  }
  if (!selectedApp.createdByAgent) {
    return { app: selectedApp, enabled: false };
  }

  const enabled = await evaluateBooleanFlag("app-source-export", false, {
    user,
  });

  return { app: selectedApp, enabled };
};

export const appsRouter = {
  exportSource: protectedProcedure
    .input(appInput)
    .use(requireProject())
    .handler(async ({ context, input }) => {
      const { app: selectedApp, enabled } = await getSourceExportApp(
        context.project.id,
        input.appId,
        context.user
      );
      if (!enabled) {
        throw new ORPCError("NOT_FOUND", {
          message: "App source export is unavailable.",
        });
      }

      const workspaceStatus = await getAppAgentWorkspaceStatus(selectedApp.id);
      if (workspaceStatus === "busy") {
        throw new ORPCError("CONFLICT", {
          message:
            "The app workspace is currently being edited. Try again when the agent finishes.",
        });
      }
      if (workspaceStatus === "missing") {
        throw new ORPCError("NOT_FOUND", {
          message: "App source export is unavailable.",
        });
      }

      try {
        const archive = await exportAppAgentWorkspace(selectedApp.id);
        if (!archive) {
          throw new ORPCError("NOT_FOUND", {
            message: "App source export is unavailable.",
          });
        }

        return {
          archive: new Blob([Uint8Array.from(archive)], {
            type: "application/gzip",
          }),
          fileName: `tailorkit-app-${selectedApp.id}-source.tar.gz`,
        };
      } catch (error) {
        if (error instanceof AppAgentWorkspaceBusyError) {
          throw new ORPCError("CONFLICT", { message: error.message });
        }
        throw error;
      }
    }),

  get: protectedProcedure
    .input(appInput)
    .use(requireProject())
    .handler(async ({ context, input }) => {
      const selectedApp = await getProjectApp(context.project.id, input.appId);

      if (!selectedApp) {
        throw new ORPCError("NOT_FOUND", { message: "App not found." });
      }

      const appWithDeployments = await db.query.app.findFirst({
        where: {
          id: selectedApp.id,
          projectId: context.project.id,
        },
        with: {
          deployments: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!appWithDeployments) {
        throw new ORPCError("NOT_FOUND", { message: "App not found." });
      }

      const { scopeKey, ...publicApp } = appWithDeployments;
      void scopeKey;
      return withAppAssetUrl(
        {
          ...publicApp,
          currentDeployment:
            appWithDeployments.deployments.find(
              (deployment) =>
                deployment.id === appWithDeployments.currentDeploymentId
            ) ?? null,
          deployments: appWithDeployments.deployments,
        },
        context.org.publicId,
        context.project.id
      );
    }),

  list: protectedProcedure
    .input(projectInput.merge(paginationInput))
    .use(requireProject())
    .handler(async ({ context, input }) => {
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 25;
      const search = input.search?.trim().toLowerCase();
      const offset = (page - 1) * pageSize;
      const searchPattern = search ? `%${search}%` : undefined;
      const where = searchPattern
        ? and(
            eq(app.projectId, context.project.id),
            or(
              ilike(app.name, searchPattern),
              ilike(app.publicId, searchPattern),
              sql`${app.scope}::text ILIKE ${searchPattern}`,
              ilike(app.description, searchPattern),
              sql`${app.id}::text ILIKE ${searchPattern}`
            )
          )
        : eq(app.projectId, context.project.id);
      const pageItems = await db
        .select()
        .from(app)
        .where(where)
        .orderBy(desc(app.createdAt))
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
      const [deploymentCounts, latestDeployments, currentDeployments] =
        await Promise.all([
          db
            .select({ appId: appDeployment.appId, value: count() })
            .from(appDeployment)
            .where(inArray(appDeployment.appId, appIds))
            .groupBy(appDeployment.appId),
          db
            .select()
            .from(appDeployment)
            .where(inArray(appDeployment.appId, appIds))
            .orderBy(desc(appDeployment.createdAt)),
          currentDeploymentIds.length > 0
            ? db
                .select()
                .from(appDeployment)
                .where(inArray(appDeployment.id, currentDeploymentIds))
            : Promise.resolve([]),
        ]);
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
              currentDeployment: item.currentDeploymentId
                ? (currentDeploymentById.get(item.currentDeploymentId) ?? null)
                : null,
              deploymentCount: deploymentCountByAppId.get(item.id) ?? 0,
              latestDeployment: latestDeploymentByAppId.get(item.id) ?? null,
            },
            context.org.publicId,
            context.project.id
          );
        }),
        pagination: {
          hasMore: pageItems.length > pageSize,
          page,
          pageSize,
        },
      };
    }),

  sourceExportStatus: protectedProcedure
    .input(appInput)
    .use(requireProject())
    .handler(async ({ context, input }) => {
      const { app: selectedApp, enabled } = await getSourceExportApp(
        context.project.id,
        input.appId,
        context.user
      );
      if (!enabled) {
        return "disabled" as const;
      }
      return getAppAgentWorkspaceStatus(selectedApp.id);
    }),
};
