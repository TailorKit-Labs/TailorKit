import { call, ORPCError } from "@orpc/server";
import { handleAppAgentMcpRequest, type AppAgentMcpBackend } from "@tailorkit/app-agent/mcp";
import { appAgent } from "@tailorkit/app-agent/workflows";
import { getRun, start } from "workflow/api";
import { getWorld } from "workflow/runtime";
import { authenticateCli } from "./cli-token";
import { createContext, type Context } from "./context";
import { findAppInScopes } from "./procedures";
import { APP_AGENT_MODEL } from "./routes/app-agent";
import { appRouter } from "./routes/apps";
import { canonicalizeScope, type Scope } from "./scope";

/** Bind all MCP tools to one authenticated scope; credentials never reach the sub-agent. */
export function createAppAgentMcpBackend(context: Context, scope: Scope): AppAgentMcpBackend {
  const canonicalScope = canonicalizeScope(scope);
  return {
    async listApps({ page, pageSize }) {
      const { body } = await call(
        appRouter.list,
        { body: { page, pageSize, scopes: [scope] } },
        { context },
      );
      return {
        items: body.items.map(({ id, publicId, name, description, views }) => ({
          id,
          publicId,
          name,
          description,
          views,
        })),
        pagination: body.pagination,
      };
    },
    async createApp({ name, description }) {
      const { body } = await call(
        appRouter.create,
        { body: { name, description: description ?? null, scope } },
        { context },
      );
      return { id: body.id, name: body.name, description: body.description };
    },
    async findApp(appId) {
      const app = await findAppInScopes(context.project.id, appId, [canonicalScope]);
      return { id: app.id, name: app.name, description: app.description };
    },
    async startRun(appId, prompt, { hostUrl, schema }) {
      // Recheck the canonical app identity immediately before starting a writer.
      const app = await findAppInScopes(context.project.id, appId, [canonicalScope]);
      return start(
        appAgent,
        [
          {
            appId: app.id,
            hostUrl,
            schema,
            model: APP_AGENT_MODEL,
            messages: [{ role: "user", content: prompt }],
          },
        ],
        {
          attributes: {
            agent: "tailorkit-app-agent",
            projectId: context.project.id,
            appId: app.id,
          },
        },
      );
    },
    async getRun(appId, runId) {
      const app = await findAppInScopes(context.project.id, appId, [canonicalScope]);
      const world = await getWorld();
      let metadata;
      try {
        metadata = await world.runs.get(runId, { resolveData: "none" });
      } catch {
        throw new ORPCError("NOT_FOUND", { message: "App sub-agent run not found." });
      }
      if (
        metadata.attributes?.agent !== "tailorkit-app-agent" ||
        metadata.attributes?.projectId !== context.project.id ||
        metadata.attributes?.appId !== app.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "App sub-agent run not found." });
      }
      return getRun<Awaited<ReturnType<typeof appAgent>>>(runId);
    },
  };
}

/** Hosted MCP transport using the same project credential and CLI scope as app chat. */
export async function handlePlatformAppAgentMcpRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new Response("Forbidden origin", { status: 403 });
  const deployToken = request.headers.get("x-tailorkit-deploy-token");
  if (!deployToken) return new Response("Missing X-TailorKit-Deploy-Token", { status: 401 });
  let context;
  try {
    context = await createContext({ request });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  let token;
  try {
    token = await authenticateCli(context.project.id, deployToken, context.runtimeService);
  } catch (error) {
    if (error instanceof ORPCError) {
      const status =
        error.code === "FORBIDDEN" ? 403 : error.code === "SERVICE_UNAVAILABLE" ? 503 : 401;
      return new Response(error.message, { status });
    }
    throw error;
  }
  return handleAppAgentMcpRequest(request, createAppAgentMcpBackend(context, token.scope));
}
