import { randomBytes } from "node:crypto";

import { call, ORPCError } from "@orpc/server";
import type {
  AppAgentMcpBackend,
  AppAgentMcpExecution,
} from "@tailorkit/agent/mcp";
import {
  AppAgentThreadError,
  resolveAppAgentThread,
} from "@tailorkit/agent/threads";
import { appAgent, cancelAppAgent } from "@tailorkit/agent/workflows";
import { issueAgentToken } from "@tailorkit/api-utils/agent-token";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { cliToken } from "@tailorkit/db/schema/cli-auth";
import { sanitizeErrorForLog } from "@tailorkit/observability";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import type { Run } from "workflow/api";
import { z } from "zod";

import type { AppAgentMcpCaller } from "#app-agent-mcp";

import type { Context } from "./context";
import { env } from "./env";
import { findAppInScopes, protectedRouter } from "./procedures";
import { appRouter, createAppRecord } from "./routes/apps";
import type { canonicalizeScopes } from "./scope";
import { canonicalizeScope } from "./scope";

interface AgentRunAttributes {
  "tailorkit.projectId": string;
  [name: string]: string;
}

export const createAppAgentMcpBackend = (
  context: Context,
  input: AppAgentMcpCaller,
  scopes: ReturnType<typeof canonicalizeScopes>
): AppAgentMcpBackend => {
  const authorizedScopes = scopes.map(({ scope }) => scope);

  const runAgent = async (
    appId: string,
    prompt: string,
    execution: AppAgentMcpExecution,
    requestedThreadId?: string
  ) => {
    execution.signal.throwIfAborted();
    const app = await findAppInScopes(
      context.project.id,
      z.uuid().safeParse(appId).success ? { id: appId } : { shortId: appId },
      scopes
    );
    if (
      !(
        env.AUTH_SECRET !== undefined &&
        env.AUTH_SECRET !== null &&
        env.AUTH_SECRET !== ""
      )
    ) {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    let threadId: string;
    try {
      threadId = await resolveAppAgentThread(app.id, requestedThreadId);
    } catch (error) {
      if (error instanceof AppAgentThreadError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
    // Reuse the existing CLI/JWT boundary for this agent's one-hour, single-scope grant.
    // A source row keeps revocation checks identical to existing app agent turns.
    const [grant] = await db
      .insert(cliToken)
      .values({
        projectId: context.project.id,

        ...canonicalizeScope(app.scope),

        expiresAt: new Date(Date.now() + 3_600_000),

        tokenHash: hashSecret(
          randomBytes(32).toString("base64url"),
          env.AUTH_SECRET
        ),
      })
      .returning();
    if (!grant) {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    let run: Run<Awaited<ReturnType<typeof appAgent>>> | undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([execution.signal, controller.signal]);
    let finished = false;
    try {
      const agentToken = await issueAgentToken(
        {
          appId: app.id,
          cliTokenId: grant.id,
          projectId: context.project.id,
          scope: app.scope,
        },
        env.AUTH_SECRET,
        env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"
      );
      execution.signal.throwIfAborted();
      const attributes: AgentRunAttributes = {
        "tailorkit.projectId": context.project.id,
      };
      if (
        input.subjectId !== undefined &&
        input.subjectId !== null &&
        input.subjectId !== ""
      ) {
        attributes["tailorkit.subjectId"] = input.subjectId;
      }
      run = await start(
        appAgent,
        [
          {
            agentToken,
            appId: app.id,
            hostUrl: input.hostUrl,
            messages: [{ content: prompt, role: "user" }],
            model: "openai/gpt-6.1-sol",
            threadId,
          },
        ],
        {
          attributes,
        }
      );
      const completed = run.returnValue;
      // Setup can fail before the workflow opens its model stream.
      void (async () => {
        try {
          await completed;
        } catch (error) {
          controller.abort(error);
        }
      })();
      await execution.onProgress({
        appId: app.shortId,
        runId: run.runId,
        status: "started",
        threadId,
      });
      let message: UIMessage | undefined;
      const { runId } = run;
      const stream = run.getReadable<UIMessageChunk>().pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          async transform(chunk, writer) {
            await execution.onProgress({
              appId: app.shortId,
              chunk,
              runId,
              threadId,
            });
            writer.enqueue(chunk);
          },
        }),
        { signal }
      );
      for await (const update of readUIMessageStream({
        stream,
        terminateOnError: true,
      })) {
        message = update;
      }
      const output = await completed;
      finished = true;
      return {
        ...output,
        appId: app.shortId,
        message,
        runId: run.runId,
        threadId,
      };
    } finally {
      controller.abort();
      try {
        if (run && !finished) {
          // Hard run cancellation doesn't execute workflow finally blocks.
          try {
            await run.cancel({
              cancelReason: "MCP request ended before its agent completed",
            });
          } catch (error) {
            // Preserve the request failure and still release resources if cancellation fails.
            console.warn("App agent MCP cancellation failed", {
              error: sanitizeErrorForLog(error),
              runId: run.runId,
            });
          } finally {
            await cancelAppAgent(app.id, run.runId);
          }
        }
      } finally {
        await db
          .update(cliToken)
          .set({ revokedAt: new Date() })
          .where(eq(cliToken.id, grant.id));
      }
    }
  };

  return {
    createApp: async ({ scope: scopeName, prompt, ...metadata }, execution) => {
      execution.signal.throwIfAborted();
      const scope = authorizedScopes.find(
        (scopeValue) => scopeValue.name === scopeName
      );
      if (!scope) {
        throw new ORPCError("FORBIDDEN", {
          message: "Scope is not authorized by the host.",
        });
      }
      const app = await createAppRecord(
        context,
        {
          description: metadata.description ?? null,
          name: metadata.name,
          scope,
        },
        true
      );
      return await runAgent(app.id, prompt, execution);
    },
    editApp: async ({ appId, prompt, threadId }, execution) =>
      await call(
        protectedRouter.handler(
          async () => await runAgent(appId, prompt, execution, threadId)
        ),
        undefined,
        { context }
      ),
    listApps: async (pagination) => {
      const { body } = await call(
        appRouter.list,
        { body: { ...pagination, scopes: authorizedScopes } },
        { context }
      );
      return body;
    },
  };
};
