import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { db } from "@tailorkit/db";
import { App, app, AppDeployment } from "@tailorkit/db/schema/apps";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { withAppAssetUrl } from "#asset-url";
import type { Context } from "#context";
import { paginatedOutput, paginationQuery } from "#pagination";
import { o, cliRouter, requireApp, requireAppInScopes } from "#procedures";
import { createPublicId } from "#public-id";
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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const createUniqueAppPublicId = async (projectId: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicId = createPublicId();
    // oxlint-disable-next-line no-await-in-loop -- Each retry depends on the result of the previous attempt.
    const existing = await db.query.app.findFirst({
      where: { projectId, publicId },
    });

    if (!existing) {
      return publicId;
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
        },
      },
    });

    return {
      body: {
        items: apps
          .slice(0, pageSize)
          .map((item) =>
            withAppAssetUrl(
              item,
              context.organization.publicId,
              context.project.id
            )
          ),
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
      path: "/apps/{appId}/lookup",
    })
  )
  .input(
    z.object({
      body: z.object({ scopes: scopesSchema }),
      params: z.object({ appId: z.string() }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(
    requireAppInScopes.adaptInput(
      ({ params: { appId }, body: { scopes } }) => ({ appId, scopes })
    )
  )
  .handler(({ context }) => ({
    body: withAppAssetUrl(
      context.app,
      context.organization.publicId,
      context.project.id
    ),
  }));

const createAppInput = z.object({
  description: App.shape.description,
  name: App.shape.name,
  scope: scopeSchema,
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
      publicId: await createUniqueAppPublicId(context.project.id),
      scope: scope.scope,
      scopeKey: scope.scopeKey,
    })
    .returning();

  if (!createdApp) {
    throw new ORPCError("BAD_REQUEST", { message: "Failed to create app." });
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
  .input(z.object({ body: createAppInput }))
  .output(z.object({ body: AppWithCurrentDeployment }))
  .handler(async ({ context, input }) => ({
    body: await createAppRecord(context, input.body),
  }));

const deleteApp = cliRouter
  .meta(
    openapi({
      method: "DELETE",
      path: "/apps/{appId}",
    })
  )
  .input(
    z.object({
      body: z.object({ scope: scopeSchema }),
      params: z.object({ appId: z.string() }),
    })
  )
  .output(z.object({ body: z.object({ id: z.uuid({ version: "v7" }) }) }))
  .use(
    requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({
      appId,
      scope,
    }))
  )
  .handler(async ({ context }) => {
    await db.delete(app).where(eq(app.id, context.app.id));

    return { body: { id: context.app.id } };
  });

const updateApp = cliRouter
  .meta(
    openapi({
      method: "PUT",
      path: "/apps/{appId}",
    })
  )
  .input(
    z.object({
      body: App.pick({ description: true, name: true }).extend({
        scope: scopeSchema,
      }),
      params: z.object({ appId: z.string() }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(
    requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({
      appId,
      scope,
    }))
  )
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
      path: "/apps/{appId}/deploy",
    })
  )
  .input(
    z.object({
      body: z.object({ deploymentId: z.string(), scope: scopeSchema }),
      params: z.object({ appId: z.string() }),
    })
  )
  .output(z.object({ body: AppWithCurrentDeployment }))
  .use(
    requireApp.adaptInput(({ params: { appId }, body: { scope } }) => ({
      appId,
      scope,
    }))
  )
  .handler(async ({ context, input }) => {
    const deploymentByPublicId = await db.query.appDeployment.findFirst({
      where: {
        appId: context.app.id,
        publicId: input.body.deploymentId,
      },
    });
    const deployment =
      deploymentByPublicId ??
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
          objectKey: `teams/${context.organization.publicId}/projects/${context.project.id}/apps/${context.app.publicId}/deployments/${deployment.publicId}/server/server.js`,
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
          context.app.publicId
        );
      }
    }

    return {
      body: withAppAssetUrl(
        { ...updatedApp, currentDeployment: deployment },
        context.organization.publicId,
        context.project.id
      ),
    };
  });

export const appRouter = o.router({
  create: createApp,
  delete: deleteApp,
  deploy,
  get: getApp,
  list: listApps,
  runtimeSession,
  update: updateApp,
});
