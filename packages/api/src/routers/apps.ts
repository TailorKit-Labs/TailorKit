import { ORPCError } from "@orpc/server";
import {
  AppAgentWorkspaceBusyError,
  exportAppAgentWorkspace,
  getAppAgentWorkspaceStatus,
} from "@patchsmith/agent/source-export";
import { withAppAssetUrl } from "@patchsmith/api-utils/app-asset-url";
import { db } from "@patchsmith/db";
import { evaluateBooleanFlag } from "@patchsmith/flags";
import { z } from "zod";

import { protectedProcedure, requireProject } from "#procedures";

import { getInstallationCounts, listAppRecords } from "./app-list";

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
  const appByShortId = await db.query.app.findFirst({
    where: {
      projectId,
      shortId: appId,
    },
  });

  if (appByShortId || !uuidPattern.test(appId)) {
    return appByShortId ?? null;
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
          fileName: `patchsmith-app-${selectedApp.id}-source.tar.gz`,
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
          currentDeployment: {
            with: { app: { columns: { name: true, shortId: true } } },
          },
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

      const [installationCount] = await getInstallationCounts(
        db,
        context.project.id,
        [selectedApp.id]
      );

      return withAppAssetUrl(
        {
          ...publicApp,
          currentDeployment: appWithDeployments.currentDeployment,
          deployments: appWithDeployments.deployments,
          installationCount: installationCount?.value ?? 0,
          sourceApp:
            appWithDeployments.currentDeployment &&
            appWithDeployments.currentDeployment.appId !== selectedApp.id
              ? appWithDeployments.currentDeployment.app
              : null,
        },
        context.project.shortId
      );
    }),

  list: protectedProcedure
    .input(projectInput.extend(paginationInput.shape))
    .use(requireProject())
    .handler(
      async ({ context, input }) =>
        await listAppRecords(db, {
          ...input,
          projectId: context.project.id,
          projectShortId: context.project.shortId,
        })
    ),

  listInstallations: protectedProcedure
    .input(appInput.extend(paginationInput.shape))
    .use(requireProject())
    .handler(async ({ context, input }) => {
      const selectedApp = await getProjectApp(context.project.id, input.appId);

      if (!selectedApp) {
        throw new ORPCError("NOT_FOUND", { message: "App not found." });
      }

      return await listAppRecords(db, {
        ...input,
        projectId: context.project.id,
        projectShortId: context.project.shortId,
        sourceAppId: selectedApp.id,
      });
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

      return await getAppAgentWorkspaceStatus(selectedApp.id);
    }),
};
