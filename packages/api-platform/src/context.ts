import { runtimeProjectAccess } from "./runtime/access";
import { env } from "./env";
import type { Organization } from "@tailorkit/db/schema/auth";
import type { Project } from "@tailorkit/db/schema/project";
import { getStorage } from "@tailorkit/storage";
import type { Storage } from "@tailorkit/storage";
import { auth } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { verifyAgentToken, type AgentToken } from "@tailorkit/api-utils/agent-token";
import { ORPCError } from "@orpc/server";
import { canonicalizeScope } from "./scope";
import { initializeObservability, setSpanAttributes, withSpan } from "@tailorkit/observability";

export interface Context {
  project: Project;
  organization: Organization;
  storage: Storage;
  /** Internal metadata-only access; not a project host credential. */
  runtimeService?: boolean;
  /** Alternative CLI authorization with the initiating credential's project and scope. */
  agentToken?: AgentToken & { token: string };
}

export async function createContext({ request }: { request: Request }): Promise<Context> {
  await initializeObservability("tailorkit-web");

  return withSpan("api_platform.create_context", async () => {
    const storage = getStorage();
    if (!storage) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Platform storage is unavailable." });
    }

    const [scheme, key] = request.headers.get("authorization")?.split(" ") ?? [];

    if (!key) {
      throw new ORPCError("UNAUTHORIZED", { message: "Authorization header not found" });
    }
    if (scheme !== "Bearer") {
      throw new ORPCError("UNAUTHORIZED", { message: "Invalid authorization scheme" });
    }

    const runtimeProject = await runtimeProjectAccess(request, env.APP_RUNTIME_SERVICE_TOKEN);
    let projectId: string;

    let agentToken: Context["agentToken"];
    if (key.split(".").length === 3) {
      if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
      let claims: AgentToken;
      try {
        claims = await verifyAgentToken(
          key,
          env.AUTH_SECRET,
          env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform",
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
          canonicalizeScope(source.scope).scopeKey === scope.scopeKey,
        );
      } catch {
        /* Malformed stored authorization is rejected. */
      }
      if (!validSource)
        throw new ORPCError("UNAUTHORIZED", {
          message: "Agent authorization revoked. Start a new agent turn.",
        });
      // An authorized JWT has its own expiry; source revocation still applies.
      agentToken = { ...claims, scope: scope.scope, token: key };
      projectId = agentToken.projectId;
    } else if (runtimeProject) {
      projectId = runtimeProject;
    } else {
      const apiKey = await auth.api.verifyApiKey({ body: { configId: "project-host", key } });
      if (!apiKey?.valid) throw new ORPCError("UNAUTHORIZED", { message: "Invalid API key" });
      projectId = apiKey.key?.metadata?.projectId;
      if (!projectId)
        throw new ORPCError("UNAUTHORIZED", {
          message: "Project ID not found in API key metadata",
        });
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
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "project",
      "tailorkit.authenticated": true,
    });

    return {
      project,
      organization: project.organization,
      storage,
      runtimeService: Boolean(runtimeProject),
      agentToken,
    };
  });
}

/** Keep unavailable dependencies distinct from rejected credentials at the HTTP boundary. */
export function contextErrorResponse(error: unknown) {
  const unauthorized = error instanceof ORPCError && error.code === "UNAUTHORIZED";
  return Response.json(
    unauthorized
      ? { code: error.code, message: error.message }
      : { code: "SERVICE_UNAVAILABLE", message: "Platform is temporarily unavailable." },
    { status: unauthorized ? 401 : 503 },
  );
}
