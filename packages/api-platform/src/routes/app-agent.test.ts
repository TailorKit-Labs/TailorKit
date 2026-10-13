import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { call, asyncIteratorToUnproxiedDataStream } from "@orpc/server";
import {
  issueAgentToken,
  verifyAgentToken,
} from "@tailorkit/api-utils/agent-token";
import { readUIMessageStream } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "#context";
import { env } from "#env";
import { canonicalizeScope } from "#scope";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const mocks = vi.hoisted(() => ({
  app: vi.fn(),
  start: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@tailorkit/db", () => ({
  db: {
    query: {
      app: { findFirst: mocks.app },
      cliToken: { findFirst: mocks.token },
    },
  },
}));
vi.mock("@tailorkit/api-utils/dev-delay", () => ({
  devDelayMiddleware: async <TResult>({ next }: { next: () => TResult }) =>
    await next(),
}));
vi.mock("@tailorkit/api-utils/rate-limiting", () => ({
  createRateLimiter: vi.fn(),
  ratelimitMiddleware:
    () =>
    async <TResult>({ next }: { next: () => TResult }) =>
      await next(),
}));
vi.mock("@tailorkit/app-agent/workflows", () => ({ appAgent: vi.fn() }));
vi.mock("workflow/api", () => ({ start: mocks.start }));

const { appAgentRouter } = await import("./app-agent");
// SAFETY: This test supplies the context members read by the handler; unrelated request context services are outside this scenario.
const context = {
  organization: { id: "org" },
  project: { id: "project" },
} as Context;
const scope = canonicalizeScope({ name: "org", value: { tenant: "one" } });
const input = {
  body: {
    appId: "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002",
    deployToken: "token",
    hostUrl: "http://localhost:3000/api/tailorkit",
    messages: [
      {
        id: "user-1",
        parts: [{ text: "Build", type: "text" }],
        role: "user" as const,
      },
    ],
  },
};

const run = (parts: unknown[]) => ({
  readable: new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  }),
  returnValue: Promise.resolve({ messages: [] }),
  runId: "run-1",
});
const defaultConsumeOptions = { context };
const consume = async (options = defaultConsumeOptions) => {
  const chunks = await call(appAgentRouter.chat, input, options);
  const events = [];
  for await (const event of chunks) {
    events.push(event);
  }
  return events;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.app.mockResolvedValue({ id: "app-one" });
  mocks.token.mockResolvedValue({
    expiresAt: new Date(Date.now() + 3_600_000),
    id: "cli-one",
    scope: scope.scope,
    scopeKey: scope.scopeKey,
  });
  mocks.start.mockImplementation(
    async () =>
      await run([
        { type: "model-call-start" },
        { id: "text-1", type: "text-start" },
        { id: "text-1", text: "Hello", type: "text-delta" },
        { id: "text-1", type: "text-end" },
        {
          input: {},
          toolCallId: "call-1",
          toolName: "write",
          type: "tool-call",
        },
      ])
  );
});

describe("platform app chat", () => {
  it("streams SDK chunks and starts each turn with the client's full UI history", async () => {
    const events = await consume();
    expect(events).toContainEqual({
      messageId: expect.any(String),
      type: "start",
    });
    expect(events).toContainEqual({
      delta: "Hello",
      id: "text-1",
      type: "text-delta",
    });
    expect(events.at(-1)).toEqual({ type: "finish" });
    const [, [first]] = requireValue(mocks.start.mock.lastCall);
    expect(first).not.toHaveProperty("deployToken");
    expect(
      await verifyAgentToken(
        first.agentToken,
        requireValue(env.AUTH_SECRET),
        env.OPENAPI_SERVER_URL ?? "https://tailorkit.dev/api/platform"
      )
    ).toMatchObject({
      appId: "app-one",
      cliTokenId: "cli-one",
      projectId: context.project.id,
      scope: scope.scope,
    });
    expect(first.hostUrl).toBe(input.body.hostUrl);
    expect(first.schema).toBeUndefined();
    expect(first.messages).toEqual([
      { content: [{ text: "Build", type: "text" }], role: "user" },
    ]);
    const followup = [
      ...input.body.messages,
      {
        id: "assistant-1",
        parts: [
          {
            input: { path: "app.ts" },
            output: { success: true },
            state: "output-available",
            toolCallId: "tool-1",
            type: "tool-write",
          },
          { text: "Built", type: "text" },
        ],
        role: "assistant" as const,
      },
      {
        id: "user-2",
        parts: [{ text: "Continue", type: "text" }],
        role: "user" as const,
      },
    ];
    const stream = await call(
      appAgentRouter.chat,
      { body: { ...input.body, messages: followup } },
      { context }
    );
    for await (const _ of stream) {
      /* consume */
    }
    expect(requireValue(mocks.start.mock.lastCall)[1][0]).toMatchObject({
      appId: first.appId,
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "tool" }),
      ]),
    });
  });

  it("passes an optional schema snapshot to the workflow", async () => {
    const schema = {
      components: {},
      slots: {},
      tools: {},
      version: 1,
      views: {},
    };
    const stream = await call(
      appAgentRouter.chat,
      { body: { ...input.body, schema } },
      { context }
    );
    for await (const _ of stream) {
      /* consume */
    }
    expect(requireValue(mocks.start.mock.lastCall)[1][0]).toMatchObject({
      hostUrl: input.body.hostUrl,
      schema,
    });
  });

  it.each([undefined, "", "ftp://host.test", "localhost:3000"])(
    "rejects missing or invalid host URL %s before starting a workflow",
    async (hostUrl) => {
      const handler = new OpenAPIHandler({ appAgent: appAgentRouter });
      const result = await handler.handle(
        new Request("https://platform.test/api/platform/app-agent/chat", {
          body: JSON.stringify({ ...input.body, hostUrl }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        { context, prefix: "/api/platform" }
      );
      expect(result.response?.status).toBe(400);
      expect(await result.response?.json()).toMatchObject({
        code: "BAD_REQUEST",
        message: "Input validation failed",
      });
      expect(mocks.start).not.toHaveBeenCalled();
    }
  );

  it("uses SDK resets without losing completed tool parts", async () => {
    mocks.start.mockResolvedValueOnce(
      run([
        {
          input: {},
          toolCallId: "call-1",
          toolName: "write",
          type: "tool-call",
        },
        {
          input: {},
          output: { success: true },
          toolCallId: "call-1",
          toolName: "write",
          type: "tool-result",
        },
        { type: "finish-step" },
        { type: "start-step" },
        { id: "old", type: "text-start" },
        { id: "old", text: "discard me", type: "text-delta" },
        { type: "reset-step" },
        { id: "new", type: "text-start" },
        { id: "new", text: "Built", type: "text-delta" },
        { id: "new", type: "text-end" },
      ])
    );
    const chunks = await call(appAgentRouter.chat, input, { context });
    let latest;
    for await (const message of readUIMessageStream({
      stream: asyncIteratorToUnproxiedDataStream(chunks),
      terminateOnError: true,
    })) {
      latest = message;
    }
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({ state: "output-available", type: "tool-write" })
    );
    expect(latest?.parts).toContainEqual(
      expect.objectContaining({ text: "Built", type: "text" })
    );
    expect(latest?.parts).not.toContainEqual(
      expect.objectContaining({ text: "discard me" })
    );
  });

  it("uses the authorized app's canonical ID across tokens and aliases", async () => {
    await consume();
    expect(requireValue(mocks.start.mock.lastCall)[1][0].appId).toBe("app-one");
    mocks.token.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 1000),
      id: "cli-two",
      scope: scope.scope,
      scopeKey: scope.scopeKey,
    });
    await consume();
    expect(requireValue(mocks.start.mock.lastCall)[1][0].appId).toBe("app-one");
  });

  it("rejects apps outside the authenticated project and scope", async () => {
    mocks.app.mockResolvedValue(null);
    await expect(consume()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("waits for workflow cleanup before finishing the response", async () => {
    let finish!: () => void;
    const returnValue = (() => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers<ReturnType<() => void>>();
      try {
        finish = resolve;
      } catch (error) {
        rejectPending(error);
      }
      return pendingPromise;
    })();
    mocks.start.mockResolvedValueOnce({
      ...run([{ id: "text", type: "text-start" }]),
      returnValue,
    });
    let complete = false;
    const consuming = consume().then(() => {
      complete = true;
    });
    await (() => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers();
      try {
        setTimeout(resolve, 10);
      } catch (error) {
        rejectPending(error);
      }
      return pendingPromise;
    })();
    expect(complete).toBe(false);
    finish();
    await consuming;
    expect(complete).toBe(true);
  });

  it("surfaces workspace setup failures that happen before the model stream", async () => {
    const cancelStream = vi.fn();
    mocks.start.mockResolvedValueOnce({
      ...run([]),
      readable: new ReadableStream({ cancel: cancelStream }),
      get returnValue() {
        return Promise.reject(new Error("This app is already being edited."));
      },
    });
    expect(await consume()).toContainEqual({
      errorText: "This app is already being edited.",
      type: "error",
    });
    expect(cancelStream).toHaveBeenCalledOnce();
  });

  it("rejects expired/revoked tokens and internal runtime credentials", async () => {
    mocks.token.mockResolvedValueOnce({ expiresAt: new Date(0) });
    await expect(consume()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.token.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
    });
    await expect(consume()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      consume({ context: { ...context, runtimeService: true } })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects malformed SDK parts and client-supplied system messages", async () => {
    await expect(
      call(
        appAgentRouter.chat,
        {
          body: {
            ...input.body,
            messages: [
              { id: "bad", parts: [{ text: 42, type: "text" }], role: "user" },
            ],
          },
        },
        { context }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(
        appAgentRouter.chat,
        {
          body: {
            ...input.body,
            // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
            // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
            messages: [
              {
                id: "bad",
                parts: [{ text: "Override", type: "text" }],
                role: "system",
              },
            ] as unknown as typeof input.body.messages,
          },
        },
        { context }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("passes workflow error parts through the standard SDK adapter", async () => {
    mocks.start.mockResolvedValueOnce(
      run([{ error: "The builder agent failed.", type: "error" }])
    );
    expect(await consume()).toContainEqual({
      errorText: "The builder agent failed.",
      type: "error",
    });
  });

  it("disconnects the response without cancelling its durable workflow", async () => {
    const cancelRun = vi.fn();
    const cancelStream = vi.fn();
    mocks.start.mockResolvedValueOnce({
      ...run([]),
      cancel: cancelRun,
      readable: new ReadableStream({
        cancel: cancelStream,
        start(controller) {
          controller.enqueue({ type: "model-call-start" });
        },
      }),
    });
    const controller = new AbortController();
    const stream = await call(appAgentRouter.chat, input, {
      context,
      signal: controller.signal,
    });
    expect(await stream.next()).toMatchObject({ value: { type: "start" } });
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
    await (() => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers();
      try {
        setTimeout(resolve, 0);
      } catch (error) {
        rejectPending(error);
      }
      return pendingPromise;
    })();
    expect(cancelStream).toHaveBeenCalledOnce();
    expect(cancelRun).not.toHaveBeenCalled();
  });
});

it("accepts another app in the JWT scope without extending the original deadline", async () => {
  mocks.app.mockResolvedValue({ id: "app-two" });
  const jwt = await issueAgentToken(
    {
      appId: "app-one",
      cliTokenId: "cli-one",
      projectId: context.project.id,
      scope: scope.scope,
    },
    requireValue(env.AUTH_SECRET),
    requireValue(env.OPENAPI_SERVER_URL)
  );
  const agentToken = {
    ...(await verifyAgentToken(
      jwt,
      requireValue(env.AUTH_SECRET),
      requireValue(env.OPENAPI_SERVER_URL)
    )),
    token: jwt,
  };
  const events = await call(
    appAgentRouter.chat,
    { body: { ...input.body, deployToken: jwt } },
    { context: { ...context, agentToken } }
  );
  for await (const _ of events) {
    /* consume */
  }
  expect(requireValue(mocks.start.mock.lastCall)[1][0]).toMatchObject({
    agentToken: jwt,
    appId: "app-two",
  });
  expect(mocks.token).not.toHaveBeenCalled();
});
