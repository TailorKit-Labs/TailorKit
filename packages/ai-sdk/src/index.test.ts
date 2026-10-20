import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { defineContract } from "@tailorkit/core/schema";
import { createServer } from "@tailorkit/core/server";
import { asSchema, generateText, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createTools } from "./index";
import type { TailorKitToolInput, TailorKitTools } from "./index";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) {
    // oxlint-disable-next-line no-await-in-loop -- Close clients before their servers.
    await close();
  }
});

const finalResult = {
  answer: "Published the app.",
  appId: "app-one",
  finishReason: "stop",
  runId: "run-one",
  threadId: "a6a61bac-770d-4538-a2df-2119281f7db8",
};
const resultSchema = z.object({
  answer: z.string(),
  appId: z.string(),
  finishReason: z.string(),
  runId: z.string(),
  threadId: z.string(),
});
const result = (): CallToolResult => ({
  content: [{ text: finalResult.answer, type: "text" }],
  structuredContent: finalResult,
});
type Operation = (
  input: { prompt: string },
  context: ServerContext
) => Promise<CallToolResult>;

const connect = async (
  operation: Operation = async () => await Promise.resolve(result()),
  failure?: (request: Request) => Response | null
) => {
  const calls: { input: { prompt: string }; name: string }[] = [];
  const requests: Request[] = [];
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: "tailorkit-app-agent",
        version: "1",
      });
      server.registerTool(
        "list_apps",
        {
          description: "List authorized apps.",
          inputSchema: z.strictObject({
            page: z.number().int().min(1).default(1),
            pageSize: z.number().int().min(1).max(100).default(100),
          }),
        },
        async () =>
          await Promise.resolve({
            content: [],
            structuredContent: { items: [] },
          })
      );
      server.registerTool(
        "create_app",
        {
          description: "Build and publish an app.",
          inputSchema: z.strictObject({
            name: z.string(),
            prompt: z.string(),
            scope: z.enum(["org"]),
          }),
          outputSchema: resultSchema,
        },
        async (input, context) => {
          calls.push({ input, name: "create_app" });
          return await operation(input, context);
        }
      );
      server.registerTool(
        "edit_app",
        {
          description: "Edit an existing app.",
          inputSchema: z.strictObject({
            appId: z.string(),
            prompt: z.string(),
            threadId: z.uuid().optional(),
          }),
          outputSchema: resultSchema,
        },
        async (input, context) => {
          calls.push({ input, name: "edit_app" });
          return await operation(input, context);
        }
      );
      return server;
    },
    { legacy: "reject", responseMode: "sse" }
  );
  cleanup.push(async () => {
    await handler.close();
  });
  const respond = async (
    incoming: IncomingMessage,
    outgoing: ServerResponse
  ) => {
    const controller = new AbortController();
    outgoing.on("close", () => {
      controller.abort();
    });
    const headers = new Headers(
      Object.entries(incoming.headers).map(([name, value]) => [
        name,
        [value].flat().join(","),
      ])
    );
    const request = new Request(`http://localhost${incoming.url}`, {
      body: incoming.method === "POST" ? await text(incoming) : undefined,
      headers,
      method: incoming.method,
      signal: controller.signal,
    });
    requests.push(request.clone());
    const response = await (failure?.(request) ?? handler.fetch(request));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) {
        outgoing.write(chunk);
      }
    }
    outgoing.end();
  };
  const http = createHttpServer((incoming, outgoing) => {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The Node HTTP callback is synchronous; handle its async response rejection.
    void respond(incoming, outgoing).catch(() => {
      outgoing.destroy();
    });
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  cleanup.push(async () => {
    http.closeAllConnections();
    const closed = once(http, "close");
    http.close();
    await closed;
  });
  const address = z.object({ port: z.number() }).parse(http.address());
  const url = `http://127.0.0.1:${address.port}/api/platform/app-agent/mcp`;
  const contract = defineContract({
    scopes: { org: z.object({ tenant: z.string() }) },
  });
  const server = createServer({
    $internal: { platformBaseUrl: url.replace("/app-agent/mcp", "") },
    baseUrl: "https://host.test/api/tailorkit",
    contract,
    projectKey: "host-key",
  });
  const context = {
    scopes: { org: { tenant: "tenant-one" } },
    subjectId: "user-one",
  };
  const client = createTools(server, context);
  return { calls, client, context, requests, server, url };
};

const usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: 1,
    total: 1,
  },
  outputTokens: { reasoning: undefined, text: 0, total: 0 },
};
const model = (name: string, input: TailorKitToolInput) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          input: JSON.stringify(input),
          toolCallId: "call",
          toolName: name,
          type: "tool-call",
        },
      ],
      finishReason: { raw: undefined, unified: "tool-calls" },
      usage,
      warnings: [],
    },
    doStream: {
      stream: simulateReadableStream({
        chunkDelayInMs: null,
        chunks: [
          {
            input: JSON.stringify(input),
            toolCallId: "call",
            toolName: name,
            type: "tool-call",
          },
          {
            finishReason: { raw: undefined, unified: "tool-calls" },
            type: "finish",
            usage,
          },
        ],
        initialDelayInMs: null,
      }),
    },
  });
const editInput = {
  appId: "app-one",
  prompt: "Add a chart",
  threadId: finalResult.threadId,
};
const generate = async (
  client: TailorKitTools,
  name = "edit_app",
  input = editInput
) =>
  await generateText({
    model: model(name, input),
    prompt: "Update my app.",
    tools: client,
  });

describe("MCP-backed AI SDK tools", () => {
  it("uses fixed schemas and the authenticated MCP endpoint without discovery", async () => {
    const { client, requests } = await connect();
    expect(Object.keys(client).toSorted()).toEqual([
      "create_app",
      "edit_app",
      "list_apps",
    ]);
    expect(requests).toHaveLength(0);
    const create = client.create_app;
    if (create === undefined) {
      throw new Error("Missing create_app tool");
    }
    const schema = asSchema(create.inputSchema);
    expect(await schema.jsonSchema).toMatchObject({
      properties: { scope: { enum: ["org"] } },
    });
    expect(
      await schema.validate?.({ name: "App", prompt: "Build", scope: "other" })
    ).toMatchObject({ success: false });
    await generate(client);
    for (const request of requests) {
      expect(request.url).toBe(`http://localhost/api/platform/app-agent/mcp`);
      expect(request.headers.get("authorization")).toBe("Bearer host-key");
      expect(
        JSON.parse(
          Buffer.from(
            request.headers.get("x-tailorkit-context") ?? "",
            "base64url"
          ).toString()
        )
      ).toEqual({
        hostUrl: "https://host.test/api/tailorkit",
        scopes: { org: { tenant: "tenant-one" } },
        subjectId: "user-one",
      });
      expect(request.headers.get("mcp-method")).not.toBe("tools/list");
      expect(request.headers.get("mcp-protocol-version")).toBe("2026-07-28");
    }
  });

  it.each(["create_app", "edit_app"])(
    "streams %s progress through the AI SDK before completion",
    async (name) => {
      const received = Promise.withResolvers<boolean>();
      const { client, calls } = await connect(async (_input, context) => {
        await context.mcpReq.notify({
          method: "notifications/progress",
          params: {
            message: "Building the app",
            progress: 1,
            progressToken: context.mcpReq._meta?.progressToken ?? "missing",
          },
        });
        await received.promise;
        return result();
      });
      const input =
        name === "edit_app"
          ? editInput
          : { name: "App", prompt: "Build", scope: "org" };
      const response = streamText({
        model: model(name, input),
        prompt: "Build my app",
        tools: client,
      });
      const outputs = [];
      for await (const chunk of response.stream) {
        if (chunk.type === "tool-result") {
          outputs.push(chunk);
          if (chunk.preliminary === true) {
            received.resolve(true);
          }
        }
      }
      expect(
        outputs.find((chunk) => chunk.preliminary === true)?.output
      ).toMatchObject({ status: "running" });
      expect(outputs.at(-1)).toMatchObject({
        output: {
          result: { structuredContent: finalResult },
          status: "completed",
        },
      });
      expect(calls).toEqual([{ input, name }]);
    }
  );

  it("lists apps with the fixed pagination schema", async () => {
    const { client } = await connect();
    const response = await generateText({
      model: model("list_apps", { page: 2, pageSize: 10 }),
      prompt: "Find my apps",
      tools: client,
    });
    expect(response.toolResults[0]?.output).toMatchObject({
      result: { structuredContent: { items: [] } },
      status: "completed",
    });
  });

  it("supports generateText and retains thread IDs and structured output", async () => {
    const { client, calls } = await connect();
    const response = await generate(client);
    expect(response.toolResults[0]?.output).toMatchObject({
      result: result(),
      status: "completed",
    });
    expect(calls[0]?.input).toEqual(editInput);
  });

  it("surfaces MCP tool errors without replaying mutations", async () => {
    const { client, calls } = await connect(
      async () =>
        await Promise.resolve({
          content: [{ text: "App is unavailable", type: "text" }],
          isError: true,
        })
    );
    const response = await generate(client);
    expect(
      response.content.find((chunk) => chunk.type === "tool-error")?.error
    ).toMatchObject({ message: "App is unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("rejects invalid model input before executing an MCP tool", async () => {
    const { client, calls } = await connect();
    const response = await generateText({
      model: model("create_app", {
        name: "App",
        prompt: "Build",
        scope: "other",
      }),
      prompt: "Build",
      tools: client,
    });
    expect(response.content).toContainEqual(
      expect.objectContaining({ type: "tool-error" })
    );
    expect(calls).toEqual([]);
  });

  it("cancels a running tool when the AI SDK aborts", async () => {
    const started = Promise.withResolvers<boolean>();
    const cancelled = Promise.withResolvers<boolean>();
    const { client, calls } = await connect(async (_input, context) => {
      context.mcpReq.signal.addEventListener(
        "abort",
        () => {
          cancelled.resolve(true);
        },
        { once: true }
      );
      started.resolve(true);
      await cancelled.promise;
      context.mcpReq.signal.throwIfAborted();
      return result();
    });
    const controller = new AbortController();
    const response = streamText({
      abortSignal: controller.signal,
      model: model("edit_app", editInput),
      prompt: "Edit",
      tools: client,
    });
    const consumed = response.consumeStream();
    await started.promise;
    controller.abort();
    await cancelled.promise;
    await consumed;
    expect(calls).toHaveLength(1);
  });

  it("keeps concurrent calls and their progress isolated", async () => {
    const release = Promise.withResolvers<boolean>();
    const { client, calls } = await connect(async (input, context) => {
      await context.mcpReq.notify({
        method: "notifications/progress",
        params: {
          message: input.prompt,
          progress: 1,
          progressToken: context.mcpReq._meta?.progressToken ?? "missing",
        },
      });
      await release.promise;
      return {
        content: [],
        structuredContent: { ...finalResult, answer: input.prompt },
      };
    });
    let received = 0;
    const run = async (prompt: string) => {
      const response = streamText({
        model: model("edit_app", { ...editInput, prompt }),
        prompt,
        tools: client,
      });
      const outputs = [];
      for await (const chunk of response.stream) {
        if (chunk.type !== "tool-result") {
          continue;
        }
        outputs.push(chunk.output);
        if (chunk.preliminary === true) {
          received += 1;
          if (received === 2) {
            release.resolve(true);
          }
        }
      }
      expect(outputs[0]).toMatchObject({
        progress: { message: prompt },
        status: "running",
      });
      expect(outputs.at(-1)).toMatchObject({
        result: { structuredContent: { answer: prompt } },
        status: "completed",
      });
    };
    await Promise.all([run("First change"), run("Second change")]);
    expect(calls).toHaveLength(2);
  });

  it("does not retry an HTTP failure for a mutation", async () => {
    let attempts = 0;
    const { client } = await connect(undefined, (request) => {
      if (request.headers.get("mcp-method") === "tools/call") {
        attempts += 1;
        return new Response("Unavailable", { status: 503 });
      }
      return null;
    });
    const response = await generate(client);
    expect(
      response.content.find((chunk) => chunk.type === "tool-error")
    ).toBeDefined();
    expect(attempts).toBe(1);
  });

  it("surfaces unavailable tools without discovery or mutation retries", async () => {
    const { client, calls } = await connect(undefined, (request) => {
      if (request.headers.get("mcp-method") === "tools/call") {
        return Response.json({
          error: { code: -32_601, message: "Unknown tool" },
          id: 0,
          jsonrpc: "2.0",
        });
      }
      return null;
    });
    const response = await generate(client);
    expect(response.content).toContainEqual(
      expect.objectContaining({ type: "tool-error" })
    );
    const error = z
      .object({ message: z.string() })
      .parse(
        response.content.find((chunk) => chunk.type === "tool-error")?.error
      );
    expect(error.message).toContain("Unknown tool");
    expect(calls).toEqual([]);
  });

  it("requires an authorized scope", () => {
    const server = {
      mcp: {
        transport: async () =>
          await Promise.resolve({ headers: {}, url: "https://platform.test" }),
      },
    };
    expect(() =>
      createTools(server, { scopes: {}, subjectId: "user-one" })
    ).toThrow("At least one host scope");
  });
});
