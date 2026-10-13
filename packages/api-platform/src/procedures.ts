import { openapi } from "@orpc/openapi";
import { ORPCError, os } from "@orpc/server";
import { devDelayMiddleware } from "@tailorkit/api-utils/dev-delay";
import {
  createRateLimiter,
  ratelimitMiddleware,
} from "@tailorkit/api-utils/rate-limiting";
import { db } from "@tailorkit/db";
import type { Scope } from "@tailorkit/db/schema/scope";
import { setSpanAttributes } from "@tailorkit/observability";

import type { Context } from "./context";
import { canonicalizeScope, canonicalizeScopes, scopeMatches } from "./scope";

const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const rateLimiter = createRateLimiter({ maxRequests: 100, window: 1000 });
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type CanonicalScope = ReturnType<typeof canonicalizeScope>;

export const findAppInScopes = async (
  projectId: string,
  appId: string,
  scopes: CanonicalScope[]
) => {
  const find = (identifier: "id" | "publicId") =>
    db.query.app.findFirst({
      where: {
        RAW: (fields, { and, eq, or }) =>
          requireValue(
            and(
              eq(fields.projectId, projectId),
              eq(fields[identifier], appId),
              or(
                ...scopes.map(({ scope, scopeKey }) =>
                  and(eq(fields.scopeKey, scopeKey), eq(fields.scope, scope))
                )
              )
            )
          ),
      },
      with: { currentDeployment: { where: { status: "published" } } },
    });

  const app =
    (uuidPattern.test(appId) ? await find("id") : null) ??
    (await find("publicId"));
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
        input && isObjectValue(input) && "body" in input
          ? input.body
          : undefined;
      const requestedScope =
        body && isObjectValue(body) && "scope" in body ? body.scope : undefined;
      const scopesValue =
        body && isObjectValue(body) && "scopes" in body
          ? body.scopes
          : undefined;
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
  async ({ context, next }, input: { appId: string; scope: Scope }) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_app",
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "app",
    });

    const app = await findAppInScopes(context.project.id, input.appId, [
      canonicalizeScope(input.scope),
    ]);

    return next({ context: { ...context, app } });
  }
);

export const requireAppInScopes = o.middleware(
  async ({ context, next }, input: { appId: string; scopes: Scope[] }) => {
    setSpanAttributes({
      "tailorkit.middleware": "require_app",
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "app",
    });

    const app = await findAppInScopes(
      context.project.id,
      input.appId,
      canonicalizeScopes(input.scopes)
    );

    return next({ context: { ...context, app } });
  }
);
