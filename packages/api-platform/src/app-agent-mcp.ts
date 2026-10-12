import { randomBytes } from "node:crypto";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { call, ORPCError } from "@orpc/server";
import { createAppAgentMcp, type AppAgentMcpExecution } from "@tailorkit/app-agent/mcp";
import { appAgent, deleteSandbox } from "@tailorkit/app-agent/workflows";
import { issueAgentToken } from "@tailorkit/api-utils/agent-token";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { sanitizeErrorForLog } from "@tailorkit/observability";
import { eq } from "drizzle-orm";
import { start, type Run } from "workflow/api";
import { z } from "zod";
import { env } from "./env";
import type { Context } from "./context";
import { findAppInScopes, protectedRouter } from "./procedures";
import { canonicalizeScope, canonicalizeScopes, scopeValueSchema } from "./scope";
import { appRouter } from "./routes/apps";

const contextSchema = z.strictObject({
  scopes: z.record(z.string(), scopeValueSchema),
  subjectId: z.string().min(1).max(256).optional(),
  hostUrl: z.url({ protocol: /^https?$/u }),
});

/** Standard MCP endpoint. Host project keys authenticate caller context carried in headers. */
export async function handleAppAgentMcpRequest(
  request: Request,
  context: Context,
): Promise<Response> {
  if (context.runtimeService || context.agentToken)
    return new Response("Forbidden", { status: 403 });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  let input: z.infer<typeof contextSchema>;
  let scopes: ReturnType<typeof canonicalizeScopes>;
  try {
    const encoded = request.headers.get("x-tailorkit-context");
    if (!encoded || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/u.test(encoded))
      throw new Error("Invalid MCP context header");
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("Invalid MCP context encoding");
    input = contextSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    scopes = canonicalizeScopes(
      Object.entries(input.scopes).map(([name, value]) => ({ name, value })),
    );
    const host = new URL(input.hostUrl);
    if (host.username || host.password || host.search || host.hash)
      throw new Error("Invalid host URL");
    const origin = request.headers.get("origin");
    if (origin && origin !== host.origin) return new Response("Forbidden origin", { status: 403 });
  } catch {
    return new Response("Invalid MCP context header", { status: 400 });
  }
  const authorizedScopes = scopes.map(({ scope }) => scope);

  async function runAgent(appId: string, prompt: string, execution: AppAgentMcpExecution) {
    execution.signal.throwIfAborted();
    const app = await findAppInScopes(context.project.id, appId, scopes);
    if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
    // Reuse the existing CLI/JWT boundary for this agent's one-hour, single-scope grant.
    // A source row keeps revocation checks identical to existing app agent turns.
    const [grant] = await db
      .insert(cliToken)
      .values({
        projectId: context.project.id,
        ...canonicalizeScope(app.scope),
        tokenHash: hashSecret(randomBytes(32).toString("base64url"), env.AUTH_SECRET),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    if (!grant) throw new ORPCError("SERVICE_UNAVAILABLE");
    let run: Run<Awaited<ReturnType<typeof appAgent>>> | undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([execution.signal, controller.signal]);
    let finished = false;
    try {
      const agentToken = await issueAgentToken(
        {
          projectId: context.project.id,
          appId: app.id,
          cliTokenId: grant.id,
          scope: app.scope,
        },
        env.AUTH_SECRET,
        env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform",
      );
      execution.signal.throwIfAborted();
      run = await start(
        appAgent,
        [
          {
            appId: app.id,
            hostUrl: input.hostUrl,
            agentToken,
            model: "openai/gpt-6.1-sol",
            messages: [{ role: "user", content: prompt }],
          },
        ],
        {
          attributes: {
            "tailorkit.projectId": context.project.id,
            ...(input.subjectId ? { "tailorkit.subjectId": input.subjectId } : {}),
          },
        },
      );
      const completed = run.returnValue;
      // Setup can fail before the workflow opens its model stream.
      void completed.catch((error: unknown) => controller.abort(error));
      await execution.onProgress({ runId: run.runId, appId: app.publicId, status: "started" });
      for await (const chunk of run.readable.pipeThrough(createModelCallToUIChunkTransform(), {
        signal,
      })) {
        await execution.onProgress({ runId: run.runId, appId: app.publicId, chunk });
      }
      const output = await completed;
      finished = true;
      return { appId: app.publicId, runId: run.runId, ...output };
    } finally {
      controller.abort();
      try {
        if (run && !finished) {
          // Hard run cancellation doesn't execute workflow finally blocks.
          try {
            await run.cancel({ cancelReason: "MCP request ended before its agent completed" });
          } catch (error) {
            // Preserve the request failure and still release resources if cancellation fails.
            console.warn("App agent MCP cancellation failed", {
              runId: run.runId,
              error: sanitizeErrorForLog(error),
            });
          } finally {
            await deleteSandbox(`app-agent-${run.runId}`);
          }
        }
      } finally {
        await db.update(cliToken).set({ revokedAt: new Date() }).where(eq(cliToken.id, grant.id));
      }
    }
  }

  const handler = createAppAgentMcp(
    {
      async listApps(pagination) {
        const { body } = await call(
          appRouter.list,
          { body: { ...pagination, scopes: authorizedScopes } },
          { context },
        );
        return body;
      },
      async createApp({ scope: name, prompt, ...metadata }, execution) {
        execution.signal.throwIfAborted();
        const scope = authorizedScopes.find((scope) => scope.name === name);
        if (!scope)
          throw new ORPCError("FORBIDDEN", { message: "Scope is not authorized by the host." });
        const { body: app } = await call(
          appRouter.create,
          { body: { ...metadata, description: metadata.description ?? null, scope } },
          { context },
        );
        return runAgent(app.id, prompt, execution);
      },
      editApp: ({ appId, prompt }, execution) =>
        call(
          protectedRouter.handler(() => runAgent(appId, prompt, execution)),
          undefined,
          { context },
        ),
    },
    authorizedScopes.map(({ name }) => name),
  );
  const response = await handler.fetch(request);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-accel-buffering", "no");
  return response;
}
