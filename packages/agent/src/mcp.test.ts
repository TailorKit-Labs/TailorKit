import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createAppAgentMcp } from "./mcp";
import type { AppAgentMcpBackend, AppAgentMcpProgress } from "./mcp";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
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
      .mockResolvedValue({ appId: "new-app" }),

    editApp: vi
      .fn<AppAgentMcpBackend["editApp"]>()
      .mockResolvedValue({ appId: "existing-app" }),

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
      expect(tools.find((tool) => tool.name === name)?._meta).toEqual({
        "dev.tailorkit/agent-stream": {
          eventKey: "dev.tailorkit/agent-stream",
          notification: "notifications/progress",
          version: 1,
        },
      });
      expect(tools.find((tool) => tool.name === name)?.description).toMatch(
        /create an autonomous app agent/iu
      );
    }
    await client.callTool({ arguments: {}, name: "list_apps" });
    expect(backend.listApps).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it.each(["create_app", "edit_app"])(
    "streams ordered agent chunks from %s before its final result",
    async (name) => {
      const events: unknown[] = [];
      const progressValues: number[] = [];
      const messages: (string | undefined)[] = [];
      const received = Promise.withResolvers<ReturnType<() => void>>();
      const identity = { appId: "app", runId: "run", threadId: "thread" };
      const updates: AppAgentMcpProgress[] = [
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
        return { ...identity, finishReason: "stop" };
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
            const notification = z
              .object({
                _meta: z.object({ "dev.tailorkit/agent-stream": z.unknown() }),
              })
              .parse(progress);
            events.push(notification._meta["dev.tailorkit/agent-stream"]);
            messages.push(progress.message);
            progressValues.push(progress.progress);
            if (events.length === updates.length) {
              received.resolve();
            }
          },
        }
      );
      expect(result.isError).not.toBe(true);
      expect(events).toEqual(updates);
      expect(progressValues).toEqual([1, 2, 3, 4]);
      expect(messages).toEqual([
        "App agent started.",
        "App agent is working.",
        "Building",
        "App agent is working.",
      ]);
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
        return { appId: "app" };
      },
    });
    const result = await client.callTool({
      arguments: { appId: "app", prompt: "Change it" },
      name: "edit_app",
    });
    expect(result.structuredContent).toEqual({ appId: "app" });
  });

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
        return {};
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
