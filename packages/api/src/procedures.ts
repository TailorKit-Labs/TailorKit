import { ORPCError, os } from "@orpc/server";
import { devDelayMiddleware } from "@tailorkit/api-utils/dev-delay";
import {
  createRateLimiter,
  ratelimitMiddleware,
} from "@tailorkit/api-utils/rate-limiting";
import { auth } from "@tailorkit/auth";
import type { ac } from "@tailorkit/auth/lib/permissions";
import { db } from "@tailorkit/db";
import { setSpanAttributes } from "@tailorkit/observability";

import type { Context } from "./context";

const rateLimiter = createRateLimiter({ maxRequests: 100, window: 1000 });

export const o = os.$context<Context>().errors({
  BAD_REQUEST: {},
  CONFLICT: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  TOO_MANY_REQUESTS: {},
  UNAUTHORIZED: {},
});

export const publicProcedure = o
  .use(devDelayMiddleware)
  .use(
    ratelimitMiddleware(
      rateLimiter,
      ({ context }) => context.user?.id ?? `ip:${context.ip}`
    )
  );

const requireAuth = o.middleware(({ context, next }) => {
  setSpanAttributes({
    "tailorkit.authenticated": Boolean(context.session && context.user),
    "tailorkit.middleware": "require_auth",
  });

  if (!context.session || !context.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({
    context: {
      session: context.session,
      user: context.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

type OrgPermissions = Partial<{
  [
    K in keyof (typeof ac)["statements"]
  ]: (typeof ac)["statements"][K][number][];
}>;

/**
 * Resolves an org from `orgSlug` or `orgId` and adds it to context.
 * Optionally checks permissions — if omitted, only the org lookup is performed.
 *
 * Map the input when your procedure's shape differs from the middleware's expected input.
 *
 * @example
 * // resolve only
 * protectedProcedure
 *   .input(z.object({ orgSlug: z.string() }))
 *   .use(requireOrg())
 *   .handler(async ({ context }) => context.org)
 *
 * // with permission check + input mapping
 * protectedProcedure
 *   .input(z.object({ slug: z.string() }))
 *   .use(requireOrg({ member: ["invite"] }).adaptInput(input => ({ orgSlug: input.slug })))
 *   .handler(async ({ context }) => context.org)
 */
export const requireOrg = (permissions?: OrgPermissions) =>
  o.middleware(
    async (
      { context, next },
      input: { orgSlug: string } | { orgId: string }
    ) => {
      setSpanAttributes({
        "tailorkit.middleware": "require_org",
        "tailorkit.package": "api",
        "tailorkit.permission_check": Boolean(permissions),
        "tailorkit.resource_type": "organization",
      });

      if (!context.user) {
        throw new ORPCError("UNAUTHORIZED");
      }

      const org = await ("orgSlug" in input
        ? db.query.organization.findFirst({
            where: {
              members: { userId: context.user.id },
              slug: input.orgSlug,
            },
          })
        : db.query.organization.findFirst({
            where: { id: input.orgId, members: { userId: context.user.id } },
          }));

      if (!org) {
        throw new ORPCError("NOT_FOUND");
      }

      if (permissions) {
        const result = await auth.api.hasPermission({
          body: {
            organizationId: org.id,
            permissions,
          },
          headers: context.headers,
        });

        if (!result.success) {
          throw new ORPCError("FORBIDDEN");
        }
      }

      return next({ context: { org } });
    }
  );

type ProjectInput = ({ orgSlug: string } | { orgId: string }) &
  ({ projectSlug: string } | { projectId: string });

/**
 * Resolves a project inside an org the caller belongs to and adds both to context.
 * Optionally checks org-scoped project permissions.
 */
export const requireProject = (permissions?: OrgPermissions) =>
  o.middleware(async ({ context, next }, input: ProjectInput) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_project",
      "tailorkit.package": "api",
      "tailorkit.permission_check": Boolean(permissions),
      "tailorkit.resource_type": "project",
    });

    if (!context.user) {
      throw new ORPCError("UNAUTHORIZED");
    }

    const org = await ("orgSlug" in input
      ? db.query.organization.findFirst({
          where: { members: { userId: context.user.id }, slug: input.orgSlug },
          with: {
            projects: {
              where:
                "projectSlug" in input
                  ? { slug: input.projectSlug }
                  : { id: input.projectId },
            },
          },
        })
      : db.query.organization.findFirst({
          where: { id: input.orgId, members: { userId: context.user.id } },
          with: {
            projects: {
              where:
                "projectSlug" in input
                  ? { slug: input.projectSlug }
                  : { id: input.projectId },
            },
          },
        }));

    if (!org) {
      throw new ORPCError("NOT_FOUND");
    }

    const project = org.projects.find((p) =>
      "projectSlug" in input
        ? p.slug === input.projectSlug
        : p.id === input.projectId
    );

    if (!project) {
      throw new ORPCError("NOT_FOUND");
    }

    if (permissions) {
      const result = await auth.api.hasPermission({
        body: {
          organizationId: org.id,
          permissions,
        },
        headers: context.headers,
      });

      if (!result.success) {
        throw new ORPCError("FORBIDDEN");
      }
    }

    return next({ context: { org, project } });
  });
