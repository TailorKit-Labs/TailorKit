import {
  Client,
  fromJsonSchema,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type {
  CallToolResult,
  JSONValue,
  JsonSchemaType,
  Progress,
  Tool as McpTool,
} from "@modelcontextprotocol/client";
import { tool } from "ai";
import type { Tool, ToolExecutionOptions } from "ai";

/** Create this configuration on the host with server.mcp.transport(context). */
export interface TailorKitToolsOptions {
  url: string;
  headers: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Cancels discovery and all tool calls made by this instance. */
  abortSignal?: AbortSignal;
  /** Inactivity timeout; MCP progress resets it. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** Absolute limit for each tool call. Defaults to 30 minutes. */
  maxTotalTimeoutMs?: number;
}

export type TailorKitToolInput = Record<string, JSONValue>;
export type TailorKitToolOutput =
  | { status: "running"; progress: Progress }
  | { status: "completed"; result: CallToolResult };

export interface TailorKitTools {
  tools: Record<string, Tool<TailorKitToolInput, TailorKitToolOutput>>;
  /** Close after generation finishes, including when a stream fails. */
  close: () => Promise<void>;
}

const executeTool = async function* executeTool(
  client: Client,
  definition: McpTool,
  input: TailorKitToolInput,
  execution: Pick<ToolExecutionOptions<never>, "abortSignal">,
  options: TailorKitToolsOptions
): AsyncGenerator<TailorKitToolOutput> {
  const controller = new AbortController();
  const signals = [controller.signal];
  if (execution.abortSignal !== undefined) {
    signals.push(execution.abortSignal);
  }
  if (options.abortSignal !== undefined) {
    signals.push(options.abortSignal);
  }
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();

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
          maxTotalTimeout: options.maxTotalTimeoutMs ?? 30 * 60 * 1000,
          onprogress: (progress) => {
            latest = progress;
            changed.resolve(true);
          },
          resetTimeoutOnProgress: true,
          signal,
          timeout: options.timeoutMs ?? 60_000,
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

// Adapt the MCP SDK's closed Standard JSON Schema target union to the AI SDK's
// extensible target union. Both converters return the original wire schema.
const inputSchema = (definition: McpTool) => {
  const schema = fromJsonSchema<TailorKitToolInput>(
    // SAFETY: tools/list parsed this schema; fromJsonSchema compiles it for runtime validation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The MCP SDK wire type is broader than its validator's schema type.
    definition.inputSchema as JsonSchemaType
  );
  return {
    "~standard": {
      ...schema["~standard"],
      jsonSchema: {
        input: () => definition.inputSchema,
        output: () => definition.inputSchema,
      },
    },
  };
};

/** Discover MCP tools and stream their progress as AI SDK preliminary results. */
export const createTailorKitTools = async (
  options: TailorKitToolsOptions
): Promise<TailorKitTools> => {
  const client = new Client(
    { name: "tailorkit-ai-sdk", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  try {
    options.abortSignal?.throwIfAborted();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(options.url), {
        fetch: options.fetch,
        requestInit: { headers: options.headers },
      }),
      { signal: options.abortSignal, timeout: options.timeoutMs ?? 60_000 }
    );
    const { tools } = await client.listTools(undefined, {
      signal: options.abortSignal,
      timeout: options.timeoutMs ?? 60_000,
    });
    return {
      close: async () => {
        await client.close();
      },
      tools: Object.fromEntries(
        tools.map((definition) => [
          definition.name,
          tool({
            description: definition.description,
            execute: (input: TailorKitToolInput, execution) =>
              executeTool(client, definition, input, execution, options),
            inputSchema: inputSchema(definition),
          }),
        ])
      ),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
};
