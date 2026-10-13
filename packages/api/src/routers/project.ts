import { ORPCError } from "@orpc/server";
import { auth } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { apikey } from "@tailorkit/db/schema/auth";
import { project } from "@tailorkit/db/schema/project";
import { validateProjectSlug } from "@tailorkit/db/validate-project-slug";
import { and, desc, eq, ne } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";

import { protectedProcedure, requireOrg, requireProject } from "../procedures";

const projectInput = z.object({
  orgSlug: z.string(),
  projectSlug: z.string(),
});

const projectApiKeyConfigId = "project-host";

const projectApiKeyRateLimitMax = 1000;

const projectApiKeyRateLimitWindowMs = 1000;

const createApiKeyPrefixSuffix = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  4
);

const projectApiKeyMetadataSchema = z.object({
  projectId: z.string(),
  rotatedAt: z.string().optional(),
  rotatedToKeyId: z.string().optional(),
  status: z.enum(["active", "rotating"]).default("active"),
});

type ProjectApiKeyMetadata = z.infer<typeof projectApiKeyMetadataSchema>;

const toDate = (value: Date | string | null): Date | null => {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
};

const isKeyExpired = (key: { expiresAt: Date | string | null }) => {
  const expiresAt = toDate(key.expiresAt);
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
};

const parseProjectApiKeyMetadata = (
  metadata: Record<string, unknown> | string | null
) => {
  const value =
    typeof metadata === "string"
      ? (() => {
          try {
            return JSON.parse(metadata) as unknown;
          } catch {
            return null;
          }
        })()
      : metadata;
  const result = projectApiKeyMetadataSchema.safeParse(value);
  return result.success ? result.data : null;
};

const listAllProjectApiKeys = async ({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) => {
  const result = await db
    .select()
    .from(apikey)
    .where(
      and(
        eq(apikey.referenceId, organizationId),
        eq(apikey.configId, projectApiKeyConfigId)
      )
    )
    .orderBy(desc(apikey.createdAt));

  return result
    .map((key) => {
      const metadata = parseProjectApiKeyMetadata(key.metadata);
      if (!metadata || metadata.projectId !== projectId) {
        return null;
      }

      return {
        createdAt: toDate(key.createdAt),
        enabled: key.enabled ?? false,
        expiresAt: toDate(key.expiresAt),
        id: key.id,
        lastRequest: toDate(key.lastRequest),
        metadata,
        name: key.name,
        prefix: key.prefix,
        start: key.start,
        updatedAt: toDate(key.updatedAt),
      };
    })
    .filter((key): key is NonNullable<typeof key> => !!key);
};

const listProjectApiKeys = async ({
  organizationId,
  projectId,
}: {
  headers: Headers;
  organizationId: string;
  projectId: string;
}) => {
  const keys = await listAllProjectApiKeys({ organizationId, projectId });

  const active = keys.find((key) => key.enabled && !isKeyExpired(key));
  const previous = active
    ? keys.filter(
        (key) => key.id !== active.id && key.enabled && !isKeyExpired(key)
      )
    : [];

  return {
    active: active ? [active] : [],
    rotating: previous,
  };
};

const createProjectApiKey = ({
  organizationId,
  projectId,
  userId,
}: {
  organizationId: string;
  projectId: string;
  userId: string;
}) =>
  auth.api.createApiKey({
    body: {
      configId: projectApiKeyConfigId,
      metadata: {
        projectId,
        status: "active",
      } satisfies ProjectApiKeyMetadata,
      name: "Project host key",
      organizationId,
      prefix: `tk_proj_${createApiKeyPrefixSuffix()}`,
      rateLimitEnabled: true,
      rateLimitMax: projectApiKeyRateLimitMax,
      rateLimitTimeWindow: projectApiKeyRateLimitWindowMs,
      userId,
    },
  });

export const projectRouter = {
  apiKeys: protectedProcedure
    .input(projectInput)
    .use(requireProject())
    .handler(({ context }) =>
      listProjectApiKeys({
        headers: context.headers,
        organizationId: context.org.id,
        projectId: context.project.id,
      })
    ),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        orgSlug: z.string(),
        slug: z.string().min(1),
      })
    )
    .use(requireOrg({ project: ["create"] }))
    .handler(async ({ input, context, errors }) => {
      const slugResult = validateProjectSlug(input.slug);
      if (!slugResult.valid) {
        throw errors.BAD_REQUEST({ message: slugResult.reason });
      }

      const existing = await db.query.project.findFirst({
        where: { organizationId: context.org.id, slug: input.slug },
      });

      if (existing) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "A project with this slug already exists in this organisation.",
        });
      }

      const [createdProject] = await db
        .insert(project)
        .values({
          name: input.name.trim(),
          organizationId: context.org.id,
          slug: input.slug,
        })
        .returning();

      if (!createdProject) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to create project.",
        });
      }

      try {
        const apiKey = await createProjectApiKey({
          organizationId: context.org.id,
          projectId: createdProject.id,
          userId: context.user.id,
        });

        return { ...createdProject, apiKey };
      } catch (error) {
        await db.delete(project).where(eq(project.id, createdProject.id));
        throw error;
      }
    }),

  delete: protectedProcedure
    .input(projectInput)
    .use(requireProject({ project: ["delete"] }))
    .handler(async ({ context }) => {
      const keys = await listAllProjectApiKeys({
        organizationId: context.org.id,
        projectId: context.project.id,
      });

      await Promise.all(
        keys.map((key) =>
          auth.api.deleteApiKey({
            body: {
              configId: projectApiKeyConfigId,
              keyId: key.id,
            },
            headers: context.headers,
          })
        )
      );

      await db.delete(project).where(eq(project.id, context.project.id));

      return { id: context.project.id };
    }),

  get: protectedProcedure
    .input(projectInput)
    .use(requireProject())
    .handler(({ context }) => context.project),

  list: protectedProcedure
    .input(z.object({ orgSlug: z.string() }))
    .use(requireOrg())
    .handler(({ context }) =>
      db.query.project.findMany({
        orderBy: { createdAt: "desc" },
        where: { organizationId: context.org.id },
      })
    ),

  rotateApiKey: protectedProcedure
    .input(
      projectInput.extend({
        gracePeriodSeconds: z
          .number()
          .int()
          .min(0)
          .max(60 * 60 * 24 * 30),
      })
    )
    .use(requireProject({ project: ["update"] }))
    .handler(async ({ input, context }) => {
      const currentKeys = await listProjectApiKeys({
        headers: context.headers,
        organizationId: context.org.id,
        projectId: context.project.id,
      });

      const apiKey = await createProjectApiKey({
        organizationId: context.org.id,
        projectId: context.project.id,
        userId: context.user.id,
      });

      const rotatedAt = new Date().toISOString();

      try {
        await (input.gracePeriodSeconds === 0
          ? Promise.all(
              currentKeys.active.map((key) =>
                auth.api.deleteApiKey({
                  body: {
                    configId: projectApiKeyConfigId,
                    keyId: key.id,
                  },
                  headers: context.headers,
                })
              )
            )
          : Promise.all(
              currentKeys.active.map((key) =>
                auth.api.updateApiKey({
                  body: {
                    configId: projectApiKeyConfigId,
                    expiresIn: input.gracePeriodSeconds,
                    keyId: key.id,
                    metadata: {
                      ...key.metadata,
                      rotatedAt,
                      rotatedToKeyId: apiKey.id,
                      status: "rotating",
                    } satisfies ProjectApiKeyMetadata,
                  },
                  headers: context.headers,
                })
              )
            ));
      } catch (error) {
        await auth.api.deleteApiKey({
          body: {
            configId: projectApiKeyConfigId,
            keyId: apiKey.id,
          },
          headers: context.headers,
        });
        throw error;
      }

      return { apiKey };
    }),

  update: protectedProcedure
    .input(
      projectInput.extend({
        name: z.string().min(1),
        slug: z.string().min(1),
      })
    )
    .use(requireProject({ project: ["update"] }))
    .handler(async ({ input, context, errors }) => {
      const slugResult = validateProjectSlug(input.slug);
      if (!slugResult.valid) {
        throw errors.BAD_REQUEST({ message: slugResult.reason });
      }

      const [existing] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.organizationId, context.org.id),
            eq(project.slug, input.slug),
            ne(project.id, context.project.id)
          )
        )
        .limit(1);

      if (existing) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "A project with this slug already exists in this organisation.",
        });
      }

      const [updatedProject] = await db
        .update(project)
        .set({
          name: input.name.trim(),
          slug: input.slug,
        })
        .where(eq(project.id, context.project.id))
        .returning();

      if (!updatedProject) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to update project.",
        });
      }

      return updatedProject;
    }),
};
