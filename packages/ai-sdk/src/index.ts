import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type {
  CallToolResult,
  JSONValue,
  Progress,
  Tool as McpTool,
} from "@modelcontextprotocol/client";
import type { TailorKitHostContext } from "@tailorkit/core/server/types";
import { tool } from "ai";
import type { ToolExecutionOptions } from "ai";
import { z } from "zod";

export type TailorKitToolInput = Record<string, JSONValue>;
export type TailorKitToolOutput =
  | { status: "running"; progress: Progress }
  | { status: "completed"; result: CallToolResult };

/** The MCP capability of a configured TailorKit server. */
export interface TailorKitMcpServer<TScopes> {
  mcp: {
    transport: (context: TailorKitHostContext<TScopes>) => Promise<{
      url: string;
      headers: Record<string, string>;
    }>;
  };
}

const streamTool = async function* streamTool(
  client: Client,
  definition: McpTool,
  input: TailorKitToolInput,
  signal: AbortSignal
): AsyncGenerator<TailorKitToolOutput> {
  const controller = new AbortController();
  const callSignal = AbortSignal.any([signal, controller.signal]);
  let latest: Progress | undefined;
  let result: CallToolResult | undefined;
  let failure: Error | undefined;
  let settled = false;
  let changed = Promise.withResolvers<boolean>();
  // Progress is a snapshot: retain only the latest when the consumer is slow.
  const pending = (async () => {
    try {
      result = await client.callTool(
        { arguments: input, name: definition.name },
        {
          maxTotalTimeout: 30 * 60 * 1000,
          onprogress: (progress) => {
            latest = progress;
            changed.resolve(true);
          },
          resetTimeoutOnProgress: true,
          signal: callSignal,
          timeout: 60_000,
          toolDefinition: definition,
        }
      );
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new Error("TailorKit MCP request failed.", { cause: error });
    } finally {
      settled = true;
      changed.resolve(true);
    }
  })();

  try {
    // oxlint-disable-next-line no-unmodified-loop-condition -- The concurrent MCP request updates settled and latest.
    while (!settled || latest !== undefined) {
      changed = Promise.withResolvers<boolean>();
      if (latest !== undefined) {
        const progress = latest;
        latest = undefined;
        yield { progress, status: "running" };
      } else if (!settled) {
        // oxlint-disable-next-line no-await-in-loop -- Await the next MCP progress notification or final response.
        await changed.promise;
      }
    }
    if (failure !== undefined) {
      throw failure;
    }
    if (result === undefined) {
      throw new Error("TailorKit MCP tool completed without a result.");
    }
    if (result.isError === true) {
      const message = result.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n");
      throw new Error(message || "TailorKit MCP tool failed.");
    }
    yield { result, status: "completed" };
  } finally {
    controller.abort();
    await pending;
  }
};

const executeTool = async function* executeTool(
  transport: () => Promise<{ url: string; headers: Record<string, string> }>,
  definition: McpTool,
  input: TailorKitToolInput,
  execution: Pick<ToolExecutionOptions<never>, "abortSignal">
): AsyncGenerator<TailorKitToolOutput> {
  const controller = new AbortController();
  const signals = [controller.signal];
  if (execution.abortSignal !== undefined) {
    signals.push(execution.abortSignal);
  }
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();

  const client = new Client(
    { name: "tailorkit-ai-sdk", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  try {
    const configuration = await transport();
    signal.throwIfAborted();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(configuration.url), {
        requestInit: { headers: configuration.headers },
      }),
      { signal }
    );
    yield* streamTool(client, definition, input, signal);
  } finally {
    controller.abort();
    await client.close();
  }
};

const objectJsonSchema = z.looseObject({
  properties: z.record(z.string(), z.json()).optional(),
  required: z.array(z.string()).optional(),
  type: z.literal("object"),
});

const promptSchema = z.string().trim().min(1).max(32_000);
const agentResultSchema = z.object({
  answer: z.string(),
  appId: z.string(),
  finishReason: z.string(),
  runId: z.string(),
  threadId: z.string(),
});

/** Create fixed MCP-backed tools. Each invocation owns and closes its connection. */
export const createTools = <TScopes extends Record<string, JSONValue>>(
  tailorkit: TailorKitMcpServer<TScopes>,
  context: NoInfer<TailorKitHostContext<TScopes>>
) => {
  const scopes = Object.keys(context.scopes);
  if (scopes.length === 0) {
    throw new Error("At least one host scope is required.");
  }
  const transport = async () => await tailorkit.mcp.transport(context);
  const createSchema = z.strictObject({
    description: z.string().trim().max(255).optional(),
    name: z.string().trim().min(1).max(127),
    prompt: promptSchema,
    scope: z
      .enum(scopes)
      .describe(
        "Name of the host-authorized scope in which to create the app."
      ),
  });
  const editSchema = z.strictObject({
    appId: z.string().min(1),
    prompt: promptSchema,
    threadId: z
      .uuid()
      .optional()
      .describe(
        "Continue an existing app conversation; omit for an independent change."
      ),
  });
  const listSchema = z.strictObject({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(100),
  });
  const createDefinition = {
    inputSchema: objectJsonSchema.parse(z.toJSONSchema(createSchema)),
    name: "create_app",
    outputSchema: objectJsonSchema.parse(z.toJSONSchema(agentResultSchema)),
  };
  const editDefinition = {
    inputSchema: objectJsonSchema.parse(z.toJSONSchema(editSchema)),
    name: "edit_app",
    outputSchema: objectJsonSchema.parse(z.toJSONSchema(agentResultSchema)),
  };
  const listDefinition = {
    inputSchema: objectJsonSchema.parse(z.toJSONSchema(listSchema)),
    name: "list_apps",
  };
  return {
    create_app: tool({
      description:
        "Create a new app and run an autonomous agent to build and deploy it from your prompt. Wait for progress and the final result. Use the returned threadId with edit_app for follow-ups. Do not automatically retry a disconnected call.",
      execute: (input, execution) =>
        executeTool(transport, createDefinition, input, execution),
      inputSchema: createSchema,
    }),
    edit_app: tool({
      description:
        "Run an autonomous agent to edit and deploy an existing app. Omit threadId for a new conversation or supply a returned threadId for a follow-up. Wait for progress and the final result. Do not automatically retry a disconnected call.",
      execute: (input, execution) =>
        executeTool(transport, editDefinition, input, execution),
      inputSchema: editSchema,
    }),
    list_apps: tool({
      description:
        "List apps in the host-authorized scopes to choose an app to edit. This is a read-only lookup.",
      execute: (input, execution) =>
        executeTool(transport, listDefinition, input, execution),
      inputSchema: listSchema,
    }),
  };
};

export type TailorKitTools = ReturnType<typeof createTools>;
