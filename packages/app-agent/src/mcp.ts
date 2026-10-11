import { setTimeout as delay } from "node:timers/promises";
import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { ModelMessage } from "ai";
import { z } from "zod";

export interface AgentApp {
  id: string;
  name: string;
  description: string | null;
}

export interface AgentRun {
  runId: string;
  status: Promise<string>;
  returnValue: Promise<{ messages: ModelMessage[] }>;
  getReadable(options: { startIndex: number }): ReadableStream<ModelCallStreamPart> & {
    getTailIndex(): Promise<number>;
  };
}

export interface AgentHost {
  hostUrl: string;
  schema?: Record<string, unknown>;
}

/** All operations must enforce the caller's project and scope before returning data. */
export interface AppAgentMcpBackend {
  listApps(input: { page: number; pageSize: number }): Promise<{
    items: AgentApp[];
    pagination: { page: number; pageSize: number; hasMore: boolean };
  }>;
  createApp(input: { name: string; description?: string }): Promise<AgentApp>;
  findApp(appId: string): Promise<AgentApp>;
  startRun(appId: string, prompt: string, host: AgentHost): Promise<AgentRun>;
  /** Verify that the run belongs to this authorized app before exposing its stream. */
  getRun(appId: string, runId: string): Promise<AgentRun>;
}

type ToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
interface AgentEvent {
  index: number;
  type: "text" | "step" | "tool-start" | "tool-finish" | "reset" | "error";
  message: string;
  toolCallId?: string;
}

const instructions = `TailorKit App Agent delegates app development to a separate app-building sub-agent.
Use list_apps to find apps in the authenticated scope. create_app creates an app and starts a
new sub-agent; edit_app starts a new sub-agent in an existing app's persistent workspace.
Give the sub-agent a complete task, including the pages, behavior, and constraints it needs.
Create/edit require the host's TailorKit API URL so the sub-agent can generate real host bindings.
Supply schema when the host is local or unreachable from the sandbox.
Each editing tool streams MCP progress when requested and returns a durable runId and cursor.
If the run is still pending/running or hasMore is true, call get_app_run with that appId,
runId, and cursor to continue observing the SAME sub-agent. Do not repeat create_app/edit_app
to poll. A disconnected MCP call does not cancel its durable workflow.
If an observation fails, retry get_app_run with the returned run handle.
Only one sub-agent can edit an app at a time. Builds remain in the app workspace;
publishing/deployment is not connected. Report the sub-agent's result and limitations honestly.`;

const observationSchema = {
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(25)
    .default(25)
    .describe("Observe progress for up to this many seconds, then return a resumable run handle."),
};
const promptSchema = z
  .string()
  .trim()
  .min(1)
  .max(32_000)
  .describe("Complete instructions to delegate to the app-building sub-agent.");
const hostUrlSchema = z
  .url()
  .refine(
    (url) => ["http:", "https:"].includes(new URL(url).protocol),
    "The host API URL must use HTTP or HTTPS.",
  );
const hostSchema = {
  hostUrl: hostUrlSchema.describe(
    "The host's TailorKit API URL, usually ending in /api/tailorkit.",
  ),
  schema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Serialized host schema for a local host or generation without fetching the host."),
};

function result(data: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError,
  };
}

function messageFor(part: ModelCallStreamPart, index: number): AgentEvent | undefined {
  switch (part.type) {
    case "model-call-start":
      return { index, type: "step", message: "Starting a model step." };
    case "text-delta":
      return { index, type: "text", message: part.text };
    case "tool-call":
      return {
        index,
        type: "tool-start",
        message: `Running ${part.toolName}`,
        toolCallId: part.toolCallId,
      };
    case "tool-result":
      return {
        index,
        type: "tool-finish",
        message: `Finished ${part.toolName}`,
        toolCallId: part.toolCallId,
      };
    case "tool-error":
      return {
        index,
        type: "error",
        message: `${part.toolName} failed: ${part.error instanceof Error ? part.error.message : String(part.error)}`,
        toolCallId: part.toolCallId,
      };
    case "reset-step":
      return {
        index,
        type: "reset",
        message: "Retrying the current model step; discard its partial text.",
      };
    case "error":
      return {
        index,
        type: "error",
        message: part.error instanceof Error ? part.error.message : String(part.error),
      };
    default:
      return undefined;
  }
}

function finalText(messages: ModelMessage[]) {
  const last = messages.findLast((message) => message.role === "assistant");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function observeRun(
  app: AgentApp,
  run: AgentRun,
  cursor: number,
  waitSeconds: number,
  extra: ToolContext,
  requestSignal?: AbortSignal,
) {
  const signal = requestSignal ? AbortSignal.any([extra.signal, requestSignal]) : extra.signal;
  const stream = run.getReadable({ startIndex: cursor });
  const reader = stream.getReader();
  const events: AgentEvent[] = [];
  const deadline = Date.now() + waitSeconds * 1000;
  const progressToken = extra._meta?.progressToken;
  const notify = async (progress: number, message: string, event?: AgentEvent) => {
    if (progressToken === undefined) return;
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        message: `[App sub-agent] ${message}`,
        _meta: {
          agent: "tailorkit-app-agent",
          appId: app.id,
          runId: run.runId,
          cursor: progress,
          event,
        },
      },
    });
  };
  try {
    await notify(cursor, `Observing ${app.name}; run ${run.runId}`);
    let consumed = 0;
    while (true) {
      signal.throwIfAborted();
      const status = await run.status;
      // Read the tail after status so a terminal run includes all its persisted chunks.
      const tail = await stream.getTailIndex();
      while (cursor <= tail && consumed < 200) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        const event = messageFor(chunk.value, cursor);
        cursor += 1;
        consumed += 1;
        if (event) {
          events.push(event);
          await notify(cursor, event.message, event);
        }
      }
      const data = {
        agent: "tailorkit-app-agent",
        delegation: "sub-agent",
        app,
        appId: app.id,
        runId: run.runId,
        cursor,
        status,
        events,
        hasMore: cursor <= tail,
        published: false,
      };
      if (["completed", "failed", "cancelled"].includes(status)) {
        try {
          // Terminal status includes workflow cleanup; do not poll returnValue on active runs.
          const output = await run.returnValue;
          return result({ ...data, summary: finalText(output.messages) });
        } catch (error) {
          return result(
            { ...data, error: error instanceof Error ? error.message : String(error) },
            true,
          );
        }
      }
      if (Date.now() >= deadline || consumed >= 200) return result(data);
      await delay(Math.min(250, deadline - Date.now()), undefined, { signal });
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return result(
      {
        agent: "tailorkit-app-agent",
        delegation: "sub-agent",
        app,
        appId: app.id,
        runId: run.runId,
        cursor,
        status: "unknown",
        events,
        published: false,
        error: `Could not observe the sub-agent: ${error instanceof Error ? error.message : String(error)}. Retry get_app_run with this run handle.`,
      },
      true,
    );
  } finally {
    // Detach this observer only. The durable app sub-agent keeps working.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Create a fresh server per HTTP request; no process-local sessions or credentials. */
export function createAppAgentMcpServer(backend: AppAgentMcpBackend, requestSignal?: AbortSignal) {
  const server = new McpServer({ name: "tailorkit-app-agent", version: "1.0.0" }, { instructions });
  server.registerTool(
    "list_apps",
    {
      title: "List TailorKit apps",
      description:
        "List apps available in the authenticated project and scope, with IDs to pass to edit_app. Does not start a sub-agent.",
      inputSchema: {
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => result(await backend.listApps(input)),
  );

  server.registerTool(
    "create_app",
    {
      title: "Create an app using a sub-agent",
      description:
        "Create a new TailorKit app and delegate its implementation to a NEW app-building sub-agent in a persistent sandbox. Streams progress and returns its runId; use get_app_run to continue watching. Builds locally; does not publish.",
      inputSchema: {
        name: z.string().trim().min(1).max(127),
        description: z.string().trim().max(255).optional(),
        prompt: promptSchema,
        ...hostSchema,
        ...observationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, description, prompt, hostUrl, schema, waitSeconds }, extra) => {
      const app = await backend.createApp({ name, description });
      let run;
      try {
        run = await backend.startRun(app.id, prompt, { hostUrl, schema });
      } catch (error) {
        return result(
          {
            app,
            appId: app.id,
            error: `App created, but the sub-agent could not start: ${error instanceof Error ? error.message : String(error)}. Use edit_app to retry this app.`,
          },
          true,
        );
      }
      return observeRun(app, run, 0, waitSeconds, extra, requestSignal);
    },
  );

  server.registerTool(
    "edit_app",
    {
      title: "Edit an app using a sub-agent",
      description:
        "Delegate changes, including adding pages, to a NEW app-building sub-agent in an existing app's persistent workspace. Streams progress and returns its runId; poll get_app_run rather than starting another edit. Does not publish.",
      inputSchema: {
        appId: z.string().min(1),
        prompt: promptSchema,
        ...hostSchema,
        ...observationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ appId, prompt, hostUrl, schema, waitSeconds }, extra) => {
      const app = await backend.findApp(appId);
      const run = await backend.startRun(app.id, prompt, { hostUrl, schema });
      return observeRun(app, run, 0, waitSeconds, extra, requestSignal);
    },
  );

  server.registerTool(
    "get_app_run",
    {
      title: "Observe an app sub-agent",
      description:
        "Read status, new progress, and the final result of an existing app sub-agent. Pass the returned cursor to resume. Does NOT start a sub-agent. The run continues after a disconnect; completed means workspace cleanup has finished.",
      inputSchema: {
        appId: z.string().min(1),
        runId: z.string().min(1),
        cursor: z.number().int().min(0).default(0),
        ...observationSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ appId, runId, cursor, waitSeconds }, extra) => {
      const app = await backend.findApp(appId);
      const run = await backend.getRun(app.id, runId);
      return observeRun(app, run, cursor, waitSeconds, extra, requestSignal);
    },
  );
  return server;
}

export async function handleAppAgentMcpRequest(
  request: Request,
  backend: AppAgentMcpBackend,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new Response("Forbidden origin", { status: 403 });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  const observer = new AbortController();
  const server = createAppAgentMcpServer(
    backend,
    AbortSignal.any([request.signal, observer.signal]),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  let response;
  try {
    response = await transport.handleRequest(request);
  } catch (error) {
    await server.close();
    throw error;
  }
  if (!response.body) {
    await server.close();
    return response;
  }
  const reader = response.body.getReader();
  // The HTTP body owns this server's lifetime, including when a client disconnects.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          await server.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        observer.abort(error);
        await server.close();
      }
    },
    async cancel(reason) {
      observer.abort(reason);
      await reader.cancel(reason);
      await server.close();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
