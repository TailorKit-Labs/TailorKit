import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { db } from "@patchsmith/db";
import { App, app, AppDeployment } from "@patchsmith/db/schema/apps";
import { createShortId } from "@patchsmith/db/short-id";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { appSelectorSchema } from "#app-selector";
import { withAppAssetUrl } from "#asset-url";
import type { Context } from "#context";
import { paginatedOutput, paginationQuery } from "#pagination";
import {
  o,
  cliRouter,
  protectedRouter,
  requireApp,
  requireAppInScopes,
} from "#procedures";
import {
  canonicalizeScope,
  canonicalizeScopes,
  scopeSchema,
  scopesSchema,
} from "#scope";

import { publishRuntimeMetadata, runtimeSession } from "./runtime";

export const AppWithCurrentDeployment = App.omit({ scopeKey: true }).extend({
  clientPath: z.url().optional(),
  currentDeployment: AppDeployment.nullable(),
  logoPaths: z
    .object({ dark: z.url().optional(), light: z.url().optional() })
    .optional(),
  views: AppDeployment.shape.views,
});
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const createUniqueAppShortId = async (projectId: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shortId = createShortId();
    // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
    const existing = await db.query.app.findFirst({
      where: { projectId, shortId },
    });

    if (!existing) {
      return shortId;
    }
  }

  throw new ORPCError("BAD_REQUEST", { message: "Failed to create app id." });
};

const listApps = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps/list",
    })
  )
  .input(z.object({ body: paginationQuery.extend({ scopes: scopesSchema }) }))
  .output(paginatedOutput(AppWithCurrentDeployment))
  .handler(async ({ context, input }) => {
    const { page, pageSize } = input.body;
    const scopes = canonicalizeScopes(input.body.scopes);
    const apps = await db.query.app.findMany({
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
      orderBy: {
        createdAt: "desc",
      },
      where: {
        RAW: (fields, { and, eq: eqValue, or }) =>
          and(
            eqValue(fields.projectId, context.project.id),
            or(
              ...scopes.map(({ scope, scopeKey }) =>
                and(
                  eqValue(fields.scopeKey, scopeKey),
                  eqValue(fields.scope, scope)
                )
              )
            )
          ) ?? eqValue(fields.projectId, context.project.id),
      },
      with: {
        currentDeployment: {
          where: {
            status: "published",
          },
          with: { app: { columns: { shortId: true } } },
        },
      },
    });

    return {
      body: {
        items: apps
          .slice(0, pageSize)
          .map((item) => withAppAssetUrl(item, context.project.shortId)),
        pagination: {
          hasMore: apps.length > pageSize,
          page,
          pageSize,
        },
      },
    };
  });

const getApp = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps/lookup",
    })
  )
  .input(
    z.object({
      body: z.strictObject({ app: appSelectorSchema, scopes: scopesSchema }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireAppInScopes.adaptInput(({ body }) => body))
  .handler(({ context }) => ({
    body: withAppAssetUrl(context.app, context.project.shortId),
  }));

const createAppInput = z.object({
  description: App.shape.description,
  name: App.shape.name,
  scope: scopeSchema,
  slug: App.shape.slug.optional(),
});

export const createAppRecord = async (
  context: Context,
  input: z.infer<typeof createAppInput>,
  createdByAgent = false
) => {
  const scope = canonicalizeScope(input.scope);
  const [createdApp] = await db
    .insert(app)
    .values({
      createdByAgent,
      description: input.description?.trim() ?? undefined,
      name: input.name.trim(),
      projectId: context.project.id,
      scope: scope.scope,
      scopeKey: scope.scopeKey,
      shortId: await createUniqueAppShortId(context.project.id),
      slug: input.slug,
    })
    .onConflictDoNothing({ target: [app.projectId, app.slug] })
    .returning();

  if (!createdApp) {
    throw new ORPCError("CONFLICT", {
      message: "App slug is already in use in this project.",
    });
  }

  return {
    ...createdApp,
    currentDeployment: null,
    views: [],
  };
};

const createApp = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps",
    })
  )
  .input(z.object({ body: createAppInput.strict() }))
  .output(z.object({ body: AppWithCurrentDeployment }))
  .handler(async ({ context, input }) => ({
    body: await createAppRecord(context, input.body),
  }));

// Only the trusted host may select a source outside the destination scope.
const installApp = protectedRouter
  .meta(openapi({ method: "POST", path: "/apps/install" }))
  .input(
    z.object({
      body: z.strictObject({
        app: appSelectorSchema,
        scope: scopeSchema,
        slug: App.shape.slug.optional(),
      }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .handler(async ({ context, input }) => {
    const source = await db.query.app.findFirst({
      where: {
        projectId: context.project.id,
        ...input.body.app,
      },
      with: {
        currentDeployment: {
          where: { status: "published" },
          with: { app: { columns: { shortId: true } } },
        },
      },
    });
    const deployment = source?.currentDeployment;
    if (!source || !deployment) {
      throw new ORPCError("NOT_FOUND", {
        message: "App has no published deployment.",
      });
    }

    const scope = canonicalizeScope(input.body.scope);
    const [installed] = await db
      .insert(app)
      .values({
        currentDeploymentId: deployment.id,
        description: source.description,
        name: source.name,
        projectId: context.project.id,
        scope: scope.scope,
        scopeKey: scope.scopeKey,
        shortId: await createUniqueAppShortId(context.project.id),
        slug: input.body.slug,
      })
      .onConflictDoNothing({ target: [app.projectId, app.slug] })
      .returning();
    if (!installed) {
      throw new ORPCError("CONFLICT", {
        message: "App slug is already in use in this project.",
      });
    }

    return {
      body: withAppAssetUrl(
        { ...installed, currentDeployment: deployment },
        context.project.shortId
      ),
    };
  });

const deleteApp = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps/delete",
    })
  )
  .input(
    z.object({
      body: z.strictObject({ app: appSelectorSchema, scope: scopeSchema }),
    })
  )
  .output(z.object({ body: App.pick({ id: true }) }))
  .use(requireApp.adaptInput(({ body }) => body))
  .handler(async ({ context }) => {
    const dependent = await db.query.app.findFirst({
      columns: { id: true },
      where: {
        currentDeployment: { appId: context.app.id },
        id: { ne: context.app.id },
      },
    });
    if (dependent) {
      throw new ORPCError("CONFLICT", {
        message: "Remove installations using this app before deleting it.",
      });
    }
    try {
      await db.delete(app).where(eq(app.id, context.app.id));
    } catch (error) {
      const candidate =
        error instanceof Error && error.cause !== undefined
          ? error.cause
          : error;
      const dependencyViolation = z
        .object({
          code: z.enum(["23503", "23001"]),
          constraint: z.literal(
            "app_current_deployment_id_app_deployment_id_fkey"
          ),
        })
        .safeParse(candidate);
      if (dependencyViolation.success) {
        throw new ORPCError("CONFLICT", {
          message: "Remove installations using this app before deleting it.",
        });
      }
      throw error;
    }

    return { body: { id: context.app.id } };
  });

const updateApp = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps/update",
    })
  )
  .input(
    z.object({
      body: App.pick({ description: true, name: true })
        .extend({
          app: appSelectorSchema,
          scope: scopeSchema,
        })
        .strict(),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp.adaptInput(({ body }) => body))
  .handler(async ({ context, input }) => {
    const [updatedApp] = await db
      .update(app)
      .set({
        description:
          input.body.description === undefined
            ? undefined
            : (input.body.description?.trim() ?? null),
        name: input.body.name?.trim(),
      })
      .where(eq(app.id, context.app.id))
      .returning();

    if (!updatedApp) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to update app." });
    }

    return {
      body: {
        ...updatedApp,
        currentDeployment: null,
        views: [],
      },
    };
  });

const deploy = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/apps/deploy",
    })
  )
  .input(
    z.object({
      body: z.strictObject({
        app: appSelectorSchema,
        deploymentId: z.string(),
        scope: scopeSchema,
      }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(requireApp.adaptInput(({ body }) => body))
  .handler(async ({ context, input }) => {
    const deploymentByShortId = await db.query.appDeployment.findFirst({
      where: {
        appId: context.app.id,
        shortId: input.body.deploymentId,
      },
    });
    const deployment =
      deploymentByShortId ??
      (uuidPattern.test(input.body.deploymentId)
        ? await db.query.appDeployment.findFirst({
            where: {
              appId: context.app.id,
              id: input.body.deploymentId,
            },
          })
        : null);

    if (!deployment) {
      throw new ORPCError("NOT_FOUND", { message: "Deployment not found." });
    }

    const [updatedApp] = await db
      .update(app)
      .set({ currentDeploymentId: deployment.id })
      .where(eq(app.id, context.app.id))
      .returning();

    if (!updatedApp) {
      throw new ORPCError("BAD_REQUEST", { message: "Failed to deploy app." });
    }

    if (deployment.status === "published") {
      const server = await db.query.appDeploymentFile.findFirst({
        where: {
          appDeploymentId: deployment.id,
          objectKey: `projects/${context.project.shortId}/apps/${context.app.shortId}/deployments/${deployment.shortId}/server/server.js`,
          status: "verified",
        },
      });
      if (
        server?.checksum !== undefined &&
        server?.checksum !== null &&
        server?.checksum !== ""
      ) {
        await publishRuntimeMetadata(
          {
            appId: context.app.id,
            checksum: server.checksum,
            contentLength: server.contentLength,
            deploymentId: deployment.id,
            objectKey: server.objectKey,
            projectId: context.project.id,
          },
          context.app.shortId
        );
      }
    }

    return {
      body: withAppAssetUrl(
        { ...updatedApp, currentDeployment: deployment },
        context.project.shortId
      ),
    };
  });

export const appRouter = o.router({
  create: createApp,
  delete: deleteApp,
  deploy,
  get: getApp,
  install: installApp,
  list: listApps,
  runtimeSession,
  update: updateApp,
});
