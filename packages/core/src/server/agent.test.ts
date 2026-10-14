import { asyncIteratorToUnproxiedDataStream } from "@orpc/client";
import { openapi } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { eventIterator, os } from "@orpc/server";
import { agentChunkSchema } from "@tailorkit/client-platform/agent";
import type { AgentChunk } from "@tailorkit/client-platform/agent";
import { readUIMessageStream } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const messages = [
  {
    id: "user-1",
    parts: [{ text: "Build an app", type: "text" as const }],
    role: "user" as const,
  },
];
const hostUrl = "http://localhost:3000/api/tailorkit";
const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const events: AgentChunk[] = [
  { messageId: "answer", type: "start" },
  { type: "start-step" },
  { id: "text-1", type: "text-start" },
  { delta: "Building 🛠 ", id: "text-1", type: "text-delta" },
  {
    input: { path: "app.ts" },
    toolCallId: "tool-1",
    toolName: "write",
    type: "tool-input-available",
  },
  {
    output: { success: true },
    toolCallId: "tool-1",
    type: "tool-output-available",
  },
  { delta: "your app.", id: "text-1", type: "text-delta" },
  { id: "text-1", type: "text-end" },
  { type: "finish-step" },
  { type: "finish" },
];

const setup = (
  options: { events?: AgentChunk[]; status?: number; scopeName?: string } = {}
) => {
  const requests: Request[] = [];
  const platform = new OpenAPIHandler({
    chat: os
      .meta(openapi({ method: "POST", path: "/app-agent/chat" }))
      .output(eventIterator(agentChunkSchema))
      .handler(async function* chat() {
        yield* options.events ?? events;
      }),
  });
  const server = createTailorKitServer({
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform",
      platformFetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());
        if (request.url.endsWith("/cli-auth/verify-token")) {
          return Response.json({
            scope: {
              name: options.scopeName ?? "org",
              value: { tenant: "verified" },
            },
          });
        }
        if (
          options.status !== undefined &&
          options.status !== null &&
          options.status !== 0 &&
          !Number.isNaN(options.status)
        ) {
          return new Response("Unavailable", { status: options.status });
        }
        const result = await platform.handle(request, {
          prefix: "/api/platform",
        });
        return (
          result.response ?? new Response("Missing route", { status: 404 })
        );
      },
    },
    baseUrl: "https://example.com/api/tailorkit",
    components: {},
    projectKey: "host-project-key",
    scopes: { org: z.object({ tenant: z.string() }) },
  });
  const client = createTailorKitClient({
    fetch: async (input, init) =>
      await server.handler(new Request(input, init), {
        authenticate: () => null,
      }),
    headers: { authorization: "Bearer cli-token" },
    url: "https://host.test/api/tailorkit",
  });
  return { client, requests, server };
};

describe("host agent relay", () => {
  it("verifies CLI auth, uses the host project key, and round trips streamed events", async () => {
    const { client, requests } = setup();
    const received = [];
    for await (const event of await client.appAgent.chat({
      appId,
      hostUrl,
      messages,
    })) {
      received.push(event);
    }
    expect(received).toEqual(events);
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe(
        "Bearer host-project-key"
      );
    }
    const chat = require(
      requests.find((request) => request.url.endsWith("/chat"))
    );
    expect(await chat.json()).toEqual({
      appId,
      deployToken: "cli-token",
      hostUrl,
      messages,
    });
    expect(
      requests.filter((request) => request.url.endsWith("/verify-token"))
    ).toHaveLength(1);
  });

  it("forwards a supplied local schema without fetching from the host", async () => {
    const { client, requests } = setup();
    const schema = {
      components: {},
      slots: {},
      tools: {},
      version: 1,
      views: {},
    };
    for await (const _ of await client.appAgent.chat({
      appId,
      hostUrl,
      messages,
      schema,
    })) {
      /* consume */
    }
    const chat = require(
      requests.find((request) => request.url.endsWith("/chat"))
    );
    expect(await chat.json()).toEqual({
      appId,
      deployToken: "cli-token",
      hostUrl,
      messages,
      schema,
    });
    expect(requests.some((request) => request.url.endsWith("/schema"))).toBe(
      false
    );
  });

  it("assembles AI SDK messages across the real oRPC and OpenAPI transports", async () => {
    const { client } = setup();
    const chunks = await client.appAgent.chat({ appId, hostUrl, messages });
    let latest;
    for await (const message of readUIMessageStream({
      stream: asyncIteratorToUnproxiedDataStream(chunks),
      terminateOnError: true,
    })) {
      latest = message;
    }
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({ text: "Building 🛠 your app.", type: "text" })
    );
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({
        state: "output-available",
        toolCallId: "tool-1",
        type: "tool-write",
      })
    );
  });

  it("requires a CLI credential before contacting the platform", async () => {
    const { server, requests } = setup();
    const client = createTailorKitClient({
      fetch: async (input, init) =>
        await server.handler(new Request(input, init), {
          authenticate: () => null,
        }),
      url: "https://host.test/api/tailorkit",
    });
    await expect(
      client.appAgent.chat({ appId, hostUrl, messages })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects a token for an undeclared host scope", async () => {
    const { client } = setup({ scopeName: "forged" });
    await expect(
      client.appAgent.chat({ appId, hostUrl, messages })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails an interrupted stream without replaying the chat POST", async () => {
    const { client, requests } = setup({ events: events.slice(0, 2) });
    await expect(
      (async () => {
        for await (const _event of await client.appAgent.chat({
          appId,
          hostUrl,
          messages,
        })) {
          /* consume */
        }
      })()
    ).rejects.toThrow("ended unexpectedly");
    expect(
      requests.filter((request) => request.url.endsWith("/chat"))
    ).toHaveLength(1);
  });

  it("surfaces an upstream HTTP failure without retrying", async () => {
    const { client, requests } = setup({ status: 401 });
    await expect(
      (async () => {
        for await (const _event of await client.appAgent.chat({
          appId,
          hostUrl,
          messages,
        })) {
          /* consume */
        }
      })()
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(
      requests.filter((request) => request.url.endsWith("/chat"))
    ).toHaveLength(1);
  });
});
