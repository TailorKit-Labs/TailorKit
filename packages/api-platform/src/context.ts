import { ORPCError } from "@orpc/server";
import { verifyAgentToken } from "@patchsmith/api-utils/agent-token";
import type { AgentToken } from "@patchsmith/api-utils/agent-token";
import { auth } from "@patchsmith/auth";
import { db } from "@patchsmith/db";
import type { Organization } from "@patchsmith/db/schema/auth";
import type { Project } from "@patchsmith/db/schema/project";
import {
  initializeObservability,
  setSpanAttributes,
  withSpan,
} from "@patchsmith/observability";
import { getStorage } from "@patchsmith/storage";
import type { Storage } from "@patchsmith/storage";
import { z } from "zod";

import { env } from "./env";
import { runtimeProjectAccess } from "./runtime/access";
import { canonicalizeScope } from "./scope";

export interface Context {
  project: Project;
  organization: Organization;
  storage: Storage;
  /** Internal metadata-only access; not a project host credential. */
  runtimeService?: boolean;
  /** Alternative CLI authorization with the initiating credential's project and scope. */
  agentToken?: AgentToken & { token: string };
}

export const createContext = async ({
  request,
}: {
  request: Request;
}): Promise<Context> => {
  await initializeObservability("patchsmith-web");

  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  return await withSpan("api_platform.create_context", async () => {
    const storage = getStorage();
    if (!storage) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Platform storage is unavailable.",
      });
    }

    const [scheme, key] =
      request.headers.get("authorization")?.split(" ") ?? [];

    if (!(key !== undefined && key !== null && key !== "")) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authorization header not found",
      });
    }
    if (scheme !== "Bearer") {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Invalid authorization scheme",
      });
    }

    const runtimeProject = await runtimeProjectAccess(
      request,
      env.APP_RUNTIME_SERVICE_TOKEN
    );
    let projectId: string;

    let agentToken: Context["agentToken"];
    if (key.split(".").length === 3) {
      if (
        !(
          env.AUTH_SECRET !== undefined &&
          env.AUTH_SECRET !== null &&
          env.AUTH_SECRET !== ""
        )
      ) {
        throw new ORPCError("SERVICE_UNAVAILABLE");
      }
      let claims: AgentToken;
      try {
        claims = await verifyAgentToken(
          key,
          env.AUTH_SECRET,
          env.OPENAPI_SERVER_URL ?? "https://patchsmith.io/api/platform"
        );
        canonicalizeScope(claims.scope);
      } catch {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid or expired agent token. Start a new agent turn.",
        });
      }
      // Keep database failures outside the token-rejection catch.
      const source = await db.query.cliToken.findFirst({
        where: { id: claims.cliTokenId, projectId: claims.projectId },
      });
      const scope = canonicalizeScope(claims.scope);
      let validSource = false;
      try {
        validSource = Boolean(
          source &&
          !source.revokedAt &&
          source.scopeKey === scope.scopeKey &&
          canonicalizeScope(source.scope).scopeKey === scope.scopeKey
        );
      } catch {
        /* Malformed stored authorization is rejected. */
      }
      if (!validSource) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Agent authorization revoked. Start a new agent turn.",
        });
      }
      // An authorized JWT has its own expiry; source revocation still applies.
      agentToken = { ...claims, scope: scope.scope, token: key };
      ({ projectId } = agentToken);
    } else if (
      runtimeProject !== undefined &&
      runtimeProject !== null &&
      runtimeProject !== ""
    ) {
      projectId = runtimeProject;
    } else {
      const apiKey = await auth.api.verifyApiKey({
        body: { configId: "project-host", key },
      });
      if (!apiKey?.valid) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid API key" });
      }
      const keyProjectId = z
        .object({ projectId: z.string().min(1) })
        .safeParse(apiKey.key?.metadata).data?.projectId;
      if (keyProjectId === undefined || keyProjectId === "") {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Project ID not found in API key metadata",
        });
      }
      projectId = keyProjectId;
    }

    const project = await db.query.project.findFirst({
      where: {
        id: projectId,
      },
      with: { organization: true },
    });

    if (!project) {
      throw new ORPCError("UNAUTHORIZED", { message: "Project not found" });
    }

    if (!project.organization) {
      throw new Error("Organization not found");
    }

    setSpanAttributes({
      "patchsmith.authenticated": true,
      "patchsmith.package": "api-platform",
      "patchsmith.resource_type": "project",
    });

    return {
      agentToken,
      organization: project.organization,
      project,
      runtimeService: Boolean(runtimeProject),
      storage,
    };
  });
};

/** Keep unavailable dependencies distinct from rejected credentials at the HTTP boundary. */
export const contextErrorResponse = (cause: unknown) => {
  if (cause instanceof ORPCError && cause.code === "UNAUTHORIZED") {
    return Response.json(
      { code: "UNAUTHORIZED", message: cause.message },
      { status: 401 }
    );
  }
  return Response.json(
    {
      code: "SERVICE_UNAVAILABLE",
      message: "Platform is temporarily unavailable.",
    },
    { status: 503 }
  );
};
