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
  /** Restricted to deployment writes for one authorized app. */
  agentToken?: AgentToken;
}

export async function createContext({ request }: { request: Request }): Promise<Context> {
  await initializeObservability("tailorkit-web");

  return withSpan("api_platform.create_context", async () => {
    const storage = getStorage();
    if (!storage) {
      throw new Error("Storage not initialized");
    }

    const [scheme, key] = request.headers.get("authorization")?.split(" ") ?? [];

    if (!key) {
      throw new Error("Authorization header not found");
    }
    if (scheme !== "Bearer") {
      throw new Error("Invalid authorization scheme");
    }

    const runtimeProject = await runtimeProjectAccess(request, env.APP_RUNTIME_SERVICE_TOKEN);
    let projectId: string;

    let agentToken: AgentToken | undefined;
    if (key.split(".").length === 3) {
      if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
      try {
        agentToken = await verifyAgentToken(
          key,
          env.AUTH_SECRET,
          env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform",
        );
        const source = await db.query.cliToken.findFirst({
          where: { id: agentToken.cliTokenId, projectId: agentToken.projectId },
        });
        const scope = canonicalizeScope(agentToken.scope);
        // Source expiry cannot shorten an already authorized run. Revocation still applies.
        if (
          !source ||
          source.revokedAt ||
          source.scopeKey !== scope.scopeKey ||
          canonicalizeScope(source.scope).scopeKey !== scope.scopeKey
        )
          throw new Error("Agent authorization revoked.");
        agentToken = { ...agentToken, scope: scope.scope };
      } catch {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid, expired, or revoked agent token. Start a new agent turn.",
        });
      }
      projectId = agentToken.projectId;
    } else if (runtimeProject) {
      projectId = runtimeProject;
    } else {
      const apiKey = await auth.api.verifyApiKey({ body: { configId: "project-host", key } });
      if (!apiKey?.valid) throw new Error("Invalid API key");
      projectId = apiKey.key?.metadata?.projectId;
      if (!projectId) throw new Error("Project ID not found in API key metadata");
    }

    const project = await db.query.project.findFirst({
      where: {
        id: projectId,
      },
      with: { organization: true },
    });

    if (!project) {
      throw new Error("Project not found");
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
