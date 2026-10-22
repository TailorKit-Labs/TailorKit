import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { createProgressReporter } from "./mcp-progress";
import type { AppAgentMcpEvent } from "./mcp-progress";

export type { AppAgentMcpEvent } from "./mcp-progress";

const serverInfo = { name: "patchsmith-app-agent", version: "1.0.0" };
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

export interface AppAgentMcpExecution {
  signal: AbortSignal;
  /** Supply internal agent events for compact MCP activity reporting. */
  onProgress: (event: AppAgentMcpEvent) => Promise<void>;
}

const agentResultSchema = z.object({
  answer: z.string(),
  appId: z.string(),
  finishReason: z.string(),
  runId: z.string(),
  threadId: z.string(),
});

export type AppAgentMcpResult = z.infer<typeof agentResultSchema>;

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
  ) => Promise<AppAgentMcpResult>;
  editApp: (
    input: z.infer<typeof editSchema>,
    execution: AppAgentMcpExecution
  ) => Promise<AppAgentMcpResult>;
}

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
const result = (value: NonNullable<CallToolResult["structuredContent"]>) => ({
  content: [{ text: JSON.stringify(value), type: "text" as const }],
  structuredContent: value,
});

const runAgentTool = async (
  context: ServerContext,
  operation: (execution: AppAgentMcpExecution) => Promise<AppAgentMcpResult>
) => {
  let progress = 0;
  const { signal } = context.mcpReq;
  const progressToken = context.mcpReq._meta?.progressToken;

  const reporter =
    progressToken === undefined
      ? undefined
      : createProgressReporter(async (message) => {
          await context.mcpReq.notify({
            method: "notifications/progress",
            params: {
              message,
              progress: (progress += 1),
              progressToken,
            },
          });
        }, signal);

  try {
    const value = await operation({
      onProgress: async (event) => {
        signal.throwIfAborted();
        await reporter?.onProgress(event);
      },
      signal,
    });

    await reporter?.flush();

    return {
      content: [
        {
          text: value.answer,
          type: "text" as const,
        },
      ],
      structuredContent: value,
    };
  } finally {
    reporter?.close();
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
          annotations: {
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          description:
            "Create a new app and create an autonomous app agent to build and deploy it from your prompt. The agent writes code, runs commands, and publishes the app. Wait for the streamed agent progress and final result. A new conversation is created and its threadId is returned. Continue it with edit_app and that threadId; do not automatically retry a disconnected call.",
          inputSchema: authorizedCreateSchema,
          outputSchema: agentResultSchema,
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
          annotations: {
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
            readOnlyHint: false,
          },
          description:
            "Create an autonomous app agent to edit and deploy an existing app from your prompt. The agent writes code, runs commands, and publishes the changes. Wait for the streamed agent progress and final result. Omit threadId to start a new conversation; supply a returned threadId for a related follow-up. Do not automatically retry a disconnected call.",
          inputSchema: editSchema,
          outputSchema: agentResultSchema,
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
