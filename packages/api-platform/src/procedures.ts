import { openapi } from "@orpc/openapi";
import { ORPCError, os } from "@orpc/server";
import { devDelayMiddleware } from "@patchsmith/api-utils/dev-delay";
import {
  createRateLimiter,
  ratelimitMiddleware,
} from "@patchsmith/api-utils/rate-limiting";
import { db } from "@patchsmith/db";
import type { Scope } from "@patchsmith/db/schema/scope";
import { setSpanAttributes } from "@patchsmith/observability";

import type { AppSelector } from "#app-selector";

import type { Context } from "./context";
import { canonicalizeScope, canonicalizeScopes, scopeMatches } from "./scope";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const rateLimiter = createRateLimiter({ maxRequests: 100, window: 1000 });
type CanonicalScope = ReturnType<typeof canonicalizeScope>;

export const findAppInScopes = async (
  projectId: string,
  selector: AppSelector,
  scopes: CanonicalScope[]
) => {
  const app = await db.query.app.findFirst({
    where: {
      projectId,
      ...selector,
      RAW: (fields, { and, eq, or }) =>
        requireValue(
          and(
            or(
              ...scopes.map(({ scope, scopeKey }) =>
                and(eq(fields.scopeKey, scopeKey), eq(fields.scope, scope))
              )
            )
          )
        ),
    },
    with: {
      currentDeployment: {
        where: { status: "published" },
        with: { app: { columns: { shortId: true } } },
      },
    },
  });

  if (!app) {
    throw new ORPCError("NOT_FOUND");
  }
  return app;
};

export const o = os.$context<Context>().meta(
  openapi({
    inputStructure: "detailed",
    outputStructure: "detailed",
  })
);

const authenticatedRouter = o
  .use(devDelayMiddleware)
  .use(
    ratelimitMiddleware(rateLimiter, ({ context }) => context.organization.id)
  );

/** Existing CLI operations accept either credential with the same project/scope boundary. */
export const cliRouter = authenticatedRouter.use(
  async ({ context, next }, input) => {
    if (context.agentToken) {
      const body =
        isObjectValue(input) && "body" in input ? input.body : undefined;
      const requestedScope =
        isObjectValue(body) && "scope" in body ? body.scope : undefined;
      const scopesValue =
        isObjectValue(body) && "scopes" in body ? body.scopes : undefined;
      if (requestedScope !== undefined || scopesValue !== undefined) {
        try {
          const scopes = [
            ...(requestedScope === undefined
              ? []
              : [canonicalizeScope(requestedScope)]),
            ...(scopesValue === undefined
              ? []
              : canonicalizeScopes(scopesValue)),
          ];
          if (
            !scopes.length ||
            scopes.some(
              ({ scope }) =>
                !scopeMatches(scope, requireValue(context.agentToken).scope)
            )
          ) {
            throw new Error("Scope not authorized");
          }
        } catch {
          throw new ORPCError("FORBIDDEN", {
            message: "Requested scope is not authorized by the agent token.",
          });
        }
      }
    }
    return await next();
  }
);

export const protectedRouter = authenticatedRouter.use(
  async ({ context, next }) => {
    if (context.agentToken) {
      throw new ORPCError("FORBIDDEN");
    }
    return await next();
  }
);

export const requireApp = o.middleware(
  async ({ context, next }, input: { app: AppSelector; scope: Scope }) => {
    setSpanAttributes({
      "patchsmith.middleware": "require_app",
      "patchsmith.package": "api-platform",
      "patchsmith.resource_type": "app",
    });

    const app = await findAppInScopes(context.project.id, input.app, [
      canonicalizeScope(input.scope),
    ]);

    return await next({ context: { ...context, app } });
  }
);

export const requireAppInScopes = o.middleware(
  async ({ context, next }, input: { app: AppSelector; scopes: Scope[] }) => {
    setSpanAttributes({
      "patchsmith.middleware": "require_app",
      "patchsmith.package": "api-platform",
      "patchsmith.resource_type": "app",
    });

    const app = await findAppInScopes(
      context.project.id,
      input.app,
      canonicalizeScopes(input.scopes)
    );

    return await next({ context: { ...context, app } });
  }
);
