import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { appAgentMcpDiscovery, createAppAgentMcp } from "./mcp";
import type {
  AppAgentMcpBackend,
  AppAgentMcpEvent,
  AppAgentMcpResult,
} from "./mcp";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const completedRun: AppAgentMcpResult = {
  answer: "App agent run ended.",
  appId: "app",
  finishReason: "stop",
  runId: "run",
  threadId: "thread",
};

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map(async (close) => {
      await close();
    })
  );
});

const connect = async (overrides: Partial<AppAgentMcpBackend> = {}) => {
  const backend = {
    createApp: vi
      .fn<AppAgentMcpBackend["createApp"]>()
      .mockResolvedValue({ ...completedRun, appId: "new-app" }),

    editApp: vi
      .fn<AppAgentMcpBackend["editApp"]>()
      .mockResolvedValue({ ...completedRun, appId: "existing-app" }),

    listApps: vi.fn<AppAgentMcpBackend["listApps"]>().mockResolvedValue({
      items: [],
      pagination: { hasMore: false },
    }),
    ...overrides,
  };
  const handler = createAppAgentMcp(backend, ["org"]);
  cleanup.push(async () => {
    await handler.close();
  });
  const client = new Client(
    { name: "test", version: "1" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    }
  );
  cleanup.push(async () => {
    await client.close();
  });
  const requests: Request[] = [];
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://host.test/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return await handler.fetch(request);
      },
    })
  );
  return { backend, client, handler, requests };
};

describe("app agent MCP", () => {
  it("advertises identical identity and capabilities through public discovery", async () => {
    const { client } = await connect();
    const publicClient = new Client(
      { name: "public-discovery", version: "1" },
      { versionNegotiation: { mode: "auto" } }
    );
    cleanup.push(async () => {
      await publicClient.close();
    });
    await publicClient.connect(
      new StreamableHTTPClientTransport(new URL("https://host.test/mcp"), {
        fetch: async (input, init) =>
          await appAgentMcpDiscovery.fetch(new Request(input, init)),
      })
    );

    expect(publicClient.getProtocolEra()).toBe("modern");
    expect(publicClient.getServerCapabilities()).toEqual(
      client.getServerCapabilities()
    );
    expect(publicClient.getServerVersion()).toEqual(client.getServerVersion());
    const { tools } = await publicClient.listTools();
    expect(tools).toEqual([]);
  });

  it("discovers only three tools over the current protocol and explains agent creation", async () => {
    const { client, backend } = await connect();
    expect(client.getProtocolEra()).toBe("modern");
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual([
      "list_apps",
      "create_app",
      "edit_app",
    ]);
    expect(
      tools.find(({ name }) => name === "create_app")?.inputSchema.properties
        ?.scope
    ).toMatchObject({ enum: ["org"] });
    for (const name of ["create_app", "edit_app"]) {
      expect(tools.find((tool) => tool.name === name)?._meta).toBeUndefined();
      expect(tools.find((tool) => tool.name === name)?.description).toMatch(
        /create an autonomous app agent/iu
      );
      expect(
        tools.find((tool) => tool.name === name)?.outputSchema?.required
      ).toEqual(["answer", "appId", "finishReason", "runId", "threadId"]);
    }
    await client.callTool({ arguments: {}, name: "list_apps" });
    expect(backend.listApps).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it.each(["create_app", "edit_app"])(
    "streams standard progress from %s before its final result",
    async (name) => {
      const progressValues: number[] = [];
      const messages: (string | undefined)[] = [];
      const progressFields: string[][] = [];
      const received = Promise.withResolvers<ReturnType<() => void>>();
      const identity = { appId: "app", runId: "run", threadId: "thread" };
      const updates: AppAgentMcpEvent[] = [
        { ...identity, status: "started" },
        {
          ...identity,
          chunk: { id: "text", type: "text-start" },
          status: "streaming",
        },
        {
          ...identity,
          chunk: { delta: "Building", id: "text", type: "text-delta" },
          status: "streaming",
        },
        {
          ...identity,
          chunk: { id: "text", type: "text-end" },
          status: "streaming",
        },
      ];
      const build = async (
        _input: { prompt: string },
        execution: Parameters<AppAgentMcpBackend["editApp"]>[1]
      ) => {
        for (const update of updates) {
          // oxlint-disable-next-line no-await-in-loop -- Preserve the order of the agent stream.
          await execution.onProgress(update);
        }
        // The result cannot complete until the client receives the text delta.
        await received.promise;
        return { ...completedRun, ...identity };
      };
      const { client } = await connect({ createApp: build, editApp: build });
      const result = await client.callTool(
        {
          arguments:
            name === "create_app"
              ? { name: "App", prompt: "Build it", scope: "org" }
              : { appId: "app", prompt: "Change it" },
          name,
        },
        {
          onprogress: (progress) => {
            progressFields.push(Object.keys(progress).toSorted());
            messages.push(progress.message);
            progressValues.push(progress.progress);
            if (messages.length === 2) {
              received.resolve();
            }
          },
        }
      );
      expect(result.isError).not.toBe(true);
      // The SDK consumes progressToken before invoking onprogress.
      expect(progressFields).toEqual([
        ["message", "progress"],
        ["message", "progress"],
      ]);
      expect(progressValues).toEqual([1, 2]);
      expect(messages).toEqual(["App agent started for app app.", "Building"]);
      expect(result.structuredContent).toMatchObject(identity);
    }
  );

  it("returns the final result when a client does not request progress", async () => {
    const { client } = await connect({
      async editApp(_input, execution) {
        await execution.onProgress({
          appId: "app",
          runId: "run",
          status: "started",
          threadId: "thread",
        });
        return completedRun;
      },
    });
    const result = await client.callTool({
      arguments: { appId: "app", prompt: "Change it" },
      name: "edit_app",
    });
    expect(result.structuredContent).toEqual(completedRun);
  });

  it.each(["create_app", "edit_app"])(
    "gives standard clients useful %s progress and a readable final answer",
    async (name) => {
      const messages: (string | undefined)[] = [];
      const progressFields: string[][] = [];
      const received = Promise.withResolvers<ReturnType<() => void>>();
      const identity = { appId: "calendar", runId: "run", threadId: "thread" };
      const chunks = [
        { id: "text", type: "text-start" },
        { delta: "I am", id: "text", type: "text-delta" },
        { delta: " building a calendar.", id: "text", type: "text-delta" },
        { delta: "Private reasoning", id: "reason", type: "reasoning-delta" },
        { toolCallId: "bash", toolName: "bash", type: "tool-input-start" },
        {
          inputTextDelta: '{"command":"not yet complete',
          toolCallId: "bash",
          type: "tool-input-delta",
        },
        {
          input: { command: "pnpm check" },
          toolCallId: "bash",
          toolName: "bash",
          type: "tool-input-available",
        },
        {
          input: { file_path: "src/calendar.tsx" },
          toolCallId: "read",
          toolName: "read",
          type: "tool-input-available",
        },
        {
          errorText: "Diagnostics available in tool result",
          toolCallId: "bash",
          type: "tool-output-error",
        },
        {
          output: "File contents are not progress messages",
          toolCallId: "read",
          type: "tool-output-available",
        },
        {
          input: {},
          toolCallId: "deploy",
          toolName: "deploy",
          type: "tool-input-available",
        },
        {
          output: { exitCode: 1, stderr: "Build failed", stdout: "" },
          toolCallId: "deploy",
          type: "tool-output-available",
        },
        {
          toolCallId: "snapshot",
          toolName: "browser_snapshot",
          type: "tool-input-start",
        },
        {
          input: {
            command: "Sensitive unknown arguments",
            token: "private-value",
          },
          toolCallId: "snapshot",
          toolName: "browser_snapshot",
          type: "tool-input-available",
        },
        {
          output: { snapshot: "Partial tool output" },
          preliminary: true,
          toolCallId: "snapshot",
          type: "tool-output-available",
        },
        {
          output: { snapshot: "Full tool output" },
          toolCallId: "snapshot",
          type: "tool-output-available",
        },
        {
          input: null,
          toolCallId: "unnamed",
          toolName: "\u001B[0m\u200B",
          type: "tool-input-available",
        },
        { toolCallId: "unnamed", type: "tool-output-denied" },
        {
          errorText: "Output arrived without a known input event",
          toolCallId: "unseen",
          type: "tool-output-error",
        },
        { type: "finish" },
      ] satisfies Extract<AppAgentMcpEvent, { status: "streaming" }>["chunk"][];
      const finalOutput: AppAgentMcpResult = {
        ...identity,
        answer: "The calendar is implemented. Deployment needs a build fix.",
        finishReason: "stop",
      };
      const build = async (
        _input: { prompt: string },
        execution: Parameters<AppAgentMcpBackend["editApp"]>[1]
      ) => {
        await execution.onProgress({ ...identity, status: "started" });
        for (const chunk of chunks) {
          // oxlint-disable-next-line no-await-in-loop -- Replay the ordered agent events through the real MCP transport.
          await execution.onProgress({
            ...identity,
            chunk,
            status: "streaming",
          });
        }
        await received.promise;
        return finalOutput;
      };
      const { client } = await connect({ createApp: build, editApp: build });
      const response = await client.callTool(
        {
          arguments:
            name === "create_app"
              ? { name: "Calendar", prompt: "Build it", scope: "org" }
              : { appId: "calendar", prompt: "Change it" },
          name,
        },
        {
          // This client deliberately uses only standard MCP progress fields.
          onprogress: (progress) => {
            const { message } = progress;
            messages.push(message);
            progressFields.push(Object.keys(progress).toSorted());
            if (
              message ===
              "App agent finished generating; waiting for workflow cleanup."
            ) {
              received.resolve();
            }
          },
        }
      );
      expect(messages).toEqual([
        "App agent started for app calendar.",
        "I am",
        "I am building a calendar.",
        "Bash.",
        "Bash: pnpm check",
        "Read: src/calendar.tsx",
        "failed: Bash: pnpm check",
        "completed: Read: src/calendar.tsx",
        "Deploy: type-checking, building, and publishing app",
        "failed: Deploy: type-checking, building, and publishing app",
        "Tool: browser_snapshot",
        "completed: Tool: browser_snapshot",
        "Tool.",
        "denied: Tool.",
        "failed: Tool.",
        "App agent finished generating; waiting for workflow cleanup.",
      ]);
      for (const fields of progressFields) {
        expect(fields).toEqual(["message", "progress"]);
      }
      const answer = z
        .object({ text: z.string(), type: z.literal("text") })
        .parse(response.content[0]);
      expect(answer).toMatchObject({ type: "text" });
      expect(answer.text).toContain(
        "The calendar is implemented. Deployment needs a build fix."
      );
      expect(answer.text).not.toContain("Private reasoning");
      expect(answer.text).not.toContain("Full internal tool transcript");
      expect(response.content).toHaveLength(1);
      expect(response.structuredContent).toEqual(finalOutput);
      expect(JSON.stringify(response).length).toBeLessThan(2000);
      const progressPayload = JSON.stringify(messages);
      expect(progressPayload).not.toContain("Private reasoning");
      expect(progressPayload).not.toContain(
        "File contents are not progress messages"
      );
      expect(progressPayload).not.toContain("Sensitive unknown arguments");
      expect(progressPayload).not.toContain('snapshot":');
      expect(progressPayload).not.toContain("private-value");
    }
  );

  it("bounds and sanitizes command previews without forwarding raw tool inputs", async () => {
    const messages: (string | undefined)[] = [];
    const commands = [
      "pnpm check\n  --filter=calendar",
      `pnpm check ${"--very-long-option ".repeat(40)}`,
      'curl -H "Authorization: Bearer private-value" https://api.test',
      'API_KEY="private-value" pnpm check',
      "curl -u user:private-value https://api.test",
    ];
    const { client } = await connect({
      async editApp(_input, execution) {
        for (const [index, command] of commands.entries()) {
          // oxlint-disable-next-line no-await-in-loop -- Preserve the order of standard progress messages.
          await execution.onProgress({
            appId: "app",
            chunk: {
              input: { command },
              toolCallId: String(index),
              toolName: "bash",
              type: "tool-input-available",
            },
            runId: "run",
            status: "streaming",
            threadId: "thread",
          });
        }
        return completedRun;
      },
    });
    await client.callTool(
      { arguments: { appId: "app", prompt: "Change it" }, name: "edit_app" },
      {
        onprogress: (progress) => {
          messages.push(progress.message);
        },
      }
    );
    expect(messages[0]).toBe("Bash: pnpm check --filter=calendar");
    expect(messages[1]?.length).toBeLessThanOrEqual(320);
    expect(messages[1]).toMatch(/…$/u);
    expect(messages.slice(2)).toEqual([
      "Bash: [command with credential markers hidden]",
    ]);
    expect(JSON.stringify(messages)).not.toContain("private-value");
  });

  it.each(["create_app", "edit_app"])(
    "returns a compact %s answer even when progress is not requested",
    async (name) => {
      const answer = "Published your notes panel.";
      const build = async () =>
        await Promise.resolve({ ...completedRun, answer });
      const { client } = await connect({ createApp: build, editApp: build });
      const response = await client.callTool({
        arguments:
          name === "create_app"
            ? { name: "Notes", prompt: "Build notes", scope: "org" }
            : { appId: "app", prompt: "Build notes" },
        name,
      });
      expect(response.content[0]).toEqual({
        text: answer,
        type: "text",
      });
      expect(response.structuredContent).toEqual({
        ...completedRun,
        answer,
      });
      expect(response.content).toHaveLength(1);
      expect(JSON.stringify(response).length).toBeLessThan(1500);
    }
  );

  it("rejects legacy initialization and mismatched metadata headers", async () => {
    const { handler, requests } = await connect();
    const legacy = await handler.fetch(
      new Request("https://host.test/mcp", {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "old", version: "1" },
            protocolVersion: "2025-11-25",
          },
        }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    expect(legacy.status).toBe(400);
    const valid = requireValue(requests[0]);
    const headers = new Headers(valid.headers);
    headers.set("mcp-method", "tools/call");
    const mismatch = await handler.fetch(
      new Request(valid.url, {
        body: await valid.text(),
        headers,
        method: "POST",
      })
    );
    expect(mismatch.status).toBe(400);
  });

  it("uses stateless POST envelopes, complete results, and no protocol session", async () => {
    const { client, handler, requests } = await connect();
    await client.callTool({ arguments: {}, name: "list_apps" });
    await Promise.all(
      requests.map(async (request) => {
        expect(request.method).toBe("POST");
        expect(request.headers.get("accept")).toContain("application/json");
        expect(request.headers.get("accept")).toContain("text/event-stream");
        expect(request.headers.get("mcp-protocol-version")).toBe("2026-07-28");
        expect(request.headers.has("mcp-session-id")).toBe(false);
        const body = z
          .object({
            method: z.string(),
            params: z.object({
              _meta: z.object({
                "io.modelcontextprotocol/clientCapabilities": z.object({}),
                "io.modelcontextprotocol/protocolVersion":
                  z.literal("2026-07-28"),
              }),
            }),
          })
          .parse(await request.clone().json());
        expect(request.headers.get("mcp-method")).toBe(body.method);
        expect(body.method).not.toBe("initialize");
      })
    );
    const request = requireValue(requests.at(-1));
    expect(request.headers.get("mcp-name")).toBe("list_apps");
    const response = await handler.fetch(request.clone());
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(await response.text()).toContain('"resultType":"complete"');
  });

  it.each(["mcp-protocol-version", "mcp-method", "mcp-name"])(
    "rejects missing and mismatched %s headers with HeaderMismatch",
    async (header) => {
      const { client, handler, requests } = await connect();
      await client.callTool({ arguments: {}, name: "list_apps" });
      const valid = requireValue(requests.at(-1));
      await Promise.all(
        [undefined, "mismatch"].map(async (value) => {
          const headers = new Headers(valid.headers);
          if (value === undefined) {
            headers.delete(header);
          } else {
            headers.set(header, value);
          }
          const response = await handler.fetch(
            new Request(valid.url, {
              body: await valid.clone().text(),
              headers,
              method: "POST",
            })
          );
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            error: { code: -32_020 },
          });
        })
      );
    }
  );

  it("rejects unsupported versions and missing per-request capabilities", async () => {
    const { handler, backend } = await connect();
    const responses = await Promise.all(
      [
        { capabilities: {}, version: "2099-01-01" },
        { capabilities: undefined, version: "2026-07-28" },
      ].map(
        async ({ capabilities, version }) =>
          await handler.fetch(
            new Request("https://host.test/mcp", {
              body: JSON.stringify({
                id: 1,
                jsonrpc: "2.0",
                method: "server/discover",
                params: {
                  _meta: {
                    "io.modelcontextprotocol/clientCapabilities": capabilities,
                    "io.modelcontextprotocol/protocolVersion": version,
                  },
                },
              }),
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
                "mcp-method": "server/discover",
                "mcp-protocol-version": version,
              },
              method: "POST",
            })
          )
      )
    );
    const unsupported = requireValue(responses[0]);
    const malformed = requireValue(responses[1]);
    expect(unsupported.status).toBe(400);
    const unsupportedError = z
      .object({
        error: z.object({
          code: z.number(),
          data: z.object({
            requested: z.string(),
            supported: z.array(z.string()),
          }),
        }),
      })
      .parse(await unsupported.json()).error;
    expect(unsupportedError.code).toBe(-32_022);
    expect(unsupportedError.data.requested).toBe("2099-01-01");
    expect(unsupportedError.data.supported).toContain("2026-07-28");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: -32_602 } });
    expect(backend.listApps).not.toHaveBeenCalled();
  });

  it("rejects identity injection in tool arguments before touching the backend", async () => {
    const { client, backend } = await connect();
    const result = await client.callTool({
      arguments: {
        appId: "app",
        prompt: "Change",
        scopes: { org: { tenant: "other" } },
      },
      name: "edit_app",
    });
    expect(result.isError).toBe(true);
    expect(backend.editApp).not.toHaveBeenCalled();
  });

  it("propagates response cancellation to the running tool", async () => {
    let cancelled!: () => void;
    const cancellation = (async () => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers<ReturnType<() => void>>();
      try {
        cancelled = resolve;
      } catch (error) {
        rejectPending(error);
      }
      await pendingPromise;
    })();
    const { client } = await connect({
      async editApp(_input, execution) {
        await execution.onProgress({
          appId: "app",
          runId: "run",
          status: "started",
          threadId: "thread",
        });
        await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<ReturnType<() => void>>();
          try {
            execution.signal.addEventListener(
              "abort",
              () => {
                cancelled();
                resolve();
              },
              { once: true }
            );
          } catch (error) {
            rejectPending(error);
          }
          await pendingPromise;
        })();
        return completedRun;
      },
    });
    const controller = new AbortController();
    const call = client.callTool(
      { arguments: { appId: "app", prompt: "Change" }, name: "edit_app" },
      {
        onprogress: () => {
          controller.abort();
        },
        signal: controller.signal,
      }
    );
    await expect(call).rejects.toThrow();
    await cancellation;
  });
});
