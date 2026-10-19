import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { createProgressReporter } from "./mcp-progress";
import type { AppAgentMcpProgress } from "./mcp-progress";

export type { AppAgentMcpActivity, AppAgentMcpProgress } from "./mcp-progress";

const serverInfo = { name: "tailorkit-app-agent", version: "1.0.0" };
const capabilities = { tools: { listChanged: true } };

/** Public protocol advertisement only; no tool handlers or backend dependencies. */
export const appAgentMcpDiscovery = createMcpHandler(
  () => new McpServer(serverInfo, { capabilities }),
  { legacy: "reject" }
);

const promptSchema = z.string().trim().min(1).max(32_000);

const editSchema = z.strictObject({
  appId: z.string().min(1),
  prompt: promptSchema,
  threadId: z
    .uuid()
    .optional()
    .describe(
      "Continue this app’s existing conversation. Omit to start a new thread for an independent change."
    ),
});
const createSchema = z.strictObject({
  description: z.string().trim().max(255).optional(),
  name: z.string().trim().min(1).max(127),
  prompt: promptSchema,
  scope: z
    .string()
    .min(1)
    .describe("Name of one scope authorized by the host."),
});

const agentStreamMetadata = {
  "dev.tailorkit/agent-stream": {
    eventKey: "dev.tailorkit/agent-stream",
    notification: "notifications/progress",
    version: 2,
  },
};

export interface AppAgentMcpExecution {
  signal: AbortSignal;
  /** Supply internal agent events for compact MCP activity reporting. */
  onProgress: (event: AppAgentMcpProgress) => Promise<void>;
}

/** Implementations receive authorization from the host, never from tool arguments. */
export interface AppAgentMcpBackend {
  listApps: (input: {
    page: number;
    pageSize: number;
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
  }) => Promise<NonNullable<CallToolResult["structuredContent"]>>;
  createApp: (
    input: z.infer<typeof createSchema>,
    execution: AppAgentMcpExecution
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
  ) => Promise<NonNullable<CallToolResult["structuredContent"]>>;
  editApp: (
    input: z.infer<typeof editSchema>,
    execution: AppAgentMcpExecution
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
  ) => Promise<NonNullable<CallToolResult["structuredContent"]>>;
}

const execution = (context: ServerContext) => {
  let progress = 0;
  const progressToken = context.mcpReq._meta?.progressToken;
  const reporter = createProgressReporter(async ({ activity, message }) => {
    if (progressToken === undefined) {
      return;
    }
    await context.mcpReq.notify({
      method: "notifications/progress",
      params: {
        _meta: { "dev.tailorkit/agent-stream": activity },
        message,
        progress: (progress += 1),
        progressToken,
      },
    });
  }, context.mcpReq.signal);
  return {
    close: reporter.close,
    execution: {
      onProgress: async (event: AppAgentMcpProgress) => {
        context.mcpReq.signal.throwIfAborted();
        if (progressToken !== undefined) {
          await reporter.onProgress(event);
        }
      },
      signal: context.mcpReq.signal,
    },
    flush: reporter.flush,
  };
};

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
const result = (value: NonNullable<CallToolResult["structuredContent"]>) => ({
  content: [{ text: JSON.stringify(value), type: "text" as const }],
  structuredContent: value,
});

const agentResultSchema = z.object({
  appId: z.string(),
  deploymentUrl: z.url().optional(),
  finishReason: z.string().optional(),
  message: z
    .object({
      parts: z.array(
        z.object({ text: z.string().optional(), type: z.string() })
      ),
    })
    .optional(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
});

const compactAgentResultSchema = agentResultSchema
  .omit({ message: true })
  .extend({
    answer: z.string(),
  });

const agentResult = (
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- Match MCP's structuredContent type without introducing arbitrary keys.
  value: NonNullable<CallToolResult["structuredContent"]>
) => {
  const { message, ...identity } = agentResultSchema.parse(value);
  const { appId, deploymentUrl, runId, threadId } = identity;
  const answer = message?.parts
    .filter((part) => part.type === "text" && part.text !== undefined)
    .map((part) => part.text)
    .join("\n\n");
  const summary =
    answer === undefined || answer === "" ? "App agent run ended." : answer;
  const compact = { ...identity, answer: summary };
  const lines = [summary, `App ID: ${appId}`];
  if (deploymentUrl !== undefined) {
    lines.push(`Deployment URL: ${deploymentUrl}`);
  }
  if (threadId !== undefined) {
    lines.push(`Thread ID: ${threadId}`);
  }
  if (runId !== undefined) {
    lines.push(`Run ID: ${runId}`);
  }
  if (threadId !== undefined) {
    lines.push(
      "For a related follow-up, call edit_app with this appId and threadId."
    );
  }
  return {
    content: [
      { text: lines.join("\n\n"), type: "text" as const },
      // MCP recommends a serialized JSON fallback for structuredContent.
      // Serialize only the compact result, never the internal transcript.
      {
        annotations: { audience: ["assistant" as const], priority: 0.2 },
        text: JSON.stringify(compact),
        type: "text" as const,
      },
    ],
    structuredContent: compact,
  };
};

const runAgentTool = async (
  context: ServerContext,
  operation: (
    execution: AppAgentMcpExecution
  ) => ReturnType<AppAgentMcpBackend["editApp"]>
) => {
  const progress = execution(context);
  try {
    const value = await operation(progress.execution);
    await progress.flush();
    return agentResult(value);
  } finally {
    progress.close();
  }
};

/** MCP 2026-07-28 only: stateless HTTP, request-scoped SSE, no legacy sessions. */
export const createAppAgentMcp = (
  backend: AppAgentMcpBackend,
  scopeNames: readonly string[]
) => {
  if (!scopeNames.length) {
    throw new Error("At least one host scope is required.");
  }
  const authorizedCreateSchema = createSchema.extend({
    scope: z
      .enum(scopeNames)
      .describe(
        "Name of the host-authorized scope in which to create the app."
      ),
  });
  return createMcpHandler(
    () => {
      const server = new McpServer(serverInfo, { capabilities });
      server.registerTool(
        "list_apps",
        {
          annotations: {
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
          description:
            "List apps in the host-authorized scopes so you can choose an app for an agent to edit. This is a read-only lookup; it does not create an agent. create_app and edit_app each create an app agent to do their task.",
          inputSchema: z.strictObject({
            page: z.number().int().min(1).default(1),
            pageSize: z.number().int().min(1).max(100).default(100),
          }),
        },
        async (input) => result(await backend.listApps(input))
      );
      server.registerTool(
        "create_app",
        {
          _meta: agentStreamMetadata,
          annotations: {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          description:
            "Create a new app and create an autonomous app agent to build and deploy it from your prompt. The agent writes code, runs commands, and publishes the app. Wait for the streamed agent progress and final result. A new conversation is created and its threadId is returned. Continue it with edit_app and that threadId; do not automatically retry a disconnected call.",
          inputSchema: authorizedCreateSchema,
          outputSchema: compactAgentResultSchema,
        },
        async (input, context) =>
          await runAgentTool(
            context,
            async (progress) => await backend.createApp(input, progress)
          )
      );
      server.registerTool(
        "edit_app",
        {
          _meta: agentStreamMetadata,
          annotations: {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          description:
            "Create an autonomous app agent to edit and deploy an existing app from your prompt. The agent writes code, runs commands, and publishes the changes. Wait for the streamed agent progress and final result. Omit threadId to start a new conversation; supply a returned threadId for a related follow-up. Do not automatically retry a disconnected call.",
          inputSchema: editSchema,
          outputSchema: compactAgentResultSchema,
        },
        async (input, context) =>
          await runAgentTool(
            context,
            async (progress) => await backend.editApp(input, progress)
          )
      );
      return server;
    },
    { legacy: "reject", responseMode: "sse" }
  );
};
