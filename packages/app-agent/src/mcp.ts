import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

const promptSchema = z.string().trim().min(1).max(32_000);

const editSchema = z.strictObject({
  appId: z.string().min(1),
  prompt: promptSchema,
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
  /** Stream agent events through the MCP request's progress notifications. */
  onProgress: (event: Record<string, unknown>) => Promise<void>;
}

/** Implementations receive authorization from the host, never from tool arguments. */
export interface AppAgentMcpBackend {
  listApps: (input: {
    page: number;
    pageSize: number;
  }) => Promise<Record<string, unknown>>;
  createApp: (
    input: z.infer<typeof createSchema>,
    execution: AppAgentMcpExecution
  ) => Promise<Record<string, unknown>>;
  editApp: (
    input: z.infer<typeof editSchema>,
    execution: AppAgentMcpExecution
  ) => Promise<Record<string, unknown>>;
}

function execution(context: ServerContext): AppAgentMcpExecution {
  let progress = 0;
  const progressToken = context.mcpReq._meta?.progressToken;
  return {
    async onProgress(event) {
      context.mcpReq.signal.throwIfAborted();
      if (progressToken === undefined) return;
      await context.mcpReq.notify({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: ++progress,
          message: JSON.stringify(event),
        },
      });
    },
    signal: context.mcpReq.signal,
  };
}

function result(value: Record<string, unknown>) {
  return {
    content: [{ text: JSON.stringify(value), type: "text" as const }],
    structuredContent: value,
  };
}

/** MCP 2026-07-28 only: stateless HTTP, request-scoped SSE, no legacy sessions. */
export function createAppAgentMcp(
  backend: AppAgentMcpBackend,
  scopeNames: readonly string[]
) {
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
      const server = new McpServer({
        name: "tailorkit-app-agent",
        version: "1.0.0",
      });
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
            "Create a new app and create an autonomous app agent to build and deploy it from your prompt. The agent writes code, runs commands, and publishes the app. Wait for the streamed agent progress and final result. Each call starts a new agent; do not automatically retry a disconnected call.",
          inputSchema: authorizedCreateSchema,
        },
        async (input, context) =>
          result(await backend.createApp(input, execution(context)))
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
            "Create an autonomous app agent to edit and deploy an existing app from your prompt. The agent writes code, runs commands, and publishes the changes. Wait for the streamed agent progress and final result. Each call starts a new agent; do not automatically retry a disconnected call.",
          inputSchema: editSchema,
        },
        async (input, context) =>
          result(await backend.editApp(input, execution(context)))
      );
      return server;
    },
    { legacy: "reject", responseMode: "sse" }
  );
}
