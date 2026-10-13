import { ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";

import { env } from "#env";

import type { Context } from "./context";
import { canonicalizeScope } from "./scope";

export const authenticateCli = async (
  projectId: string,
  deployToken: string,
  runtimeService?: boolean
) => {
  if (runtimeService === true) {
    throw new ORPCError("FORBIDDEN");
  }
  if (
    !(
      env.AUTH_SECRET !== undefined &&
      env.AUTH_SECRET !== null &&
      env.AUTH_SECRET !== ""
    )
  ) {
    throw new ORPCError("SERVICE_UNAVAILABLE");
  }
  const token = await db.query.cliToken.findFirst({
    where: { projectId, tokenHash: hashSecret(deployToken, env.AUTH_SECRET) },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid CLI deploy token.",
    });
  }
  let scope: ReturnType<typeof canonicalizeScope>;
  try {
    scope = canonicalizeScope(token.scope);
  } catch {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid CLI deploy token.",
    });
  }
  if (scope.scopeKey !== token.scopeKey) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid CLI deploy token.",
    });
  }
  return { ...token, scope: scope.scope, scopeKey: scope.scopeKey };
};

/** Authenticate either the existing host-forwarded CLI token or a verified JWT context. */
export const authenticateCliRequest = async (
  context: Context,
  token: string
) => {
  if (!context.agentToken) {
    return await authenticateCli(
      context.project.id,
      token,
      context.runtimeService
    );
  }
  const agent = context.agentToken;
  if (token !== agent.token || context.runtimeService === true) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return {
    id: agent.cliTokenId,
    projectId: agent.projectId,
    ...canonicalizeScope(agent.scope),
    expiresAt: new Date(agent.exp * 1000),
  };
};
