/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- This integration fixture loads workspace or generated modules dynamically and supplies minimal platform doubles; its assertions validate the observed runtime contract. */
import type { TailorKitRouterClient } from "@tailorkit/core/server";
import type { UIMessage } from "ai";
import { readUIMessageStream } from "ai";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const chatEvents = async function* chatEvents() {
  yield {
    data: { threadId: "e773a870-df5a-4bea-9ebd-9be4c0b1897a" },
    transient: true,
    type: "data-thread" as const,
  };
  yield { messageId: "run-2", type: "start" as const };
  yield { id: "text", type: "text-start" as const };
  yield { delta: "Continued", id: "text", type: "text-delta" as const };
  yield { id: "text", type: "text-end" as const };
  yield { type: "finish" as const };
};

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const mocks = vi.hoisted(() => ({ fetchSchema: vi.fn(), tui: vi.fn() }));
vi.mock("@ai-sdk/tui", () => ({ runAgentTUI: mocks.tui }));
vi.mock("./generator/types", () => ({
  fetchSchemaFromHost: mocks.fetchSchema,
}));
const { openAgentTui } = await import("./agent-tui");
const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const messages: UIMessage[] = [
  { id: "user-1", parts: [{ text: "Build", type: "text" }], role: "user" },
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
    role: "assistant",
  },
  { id: "user-2", parts: [{ text: "Continue", type: "text" }], role: "user" },
];
const hostUrl = "http://localhost:3000/api/tailorkit";
const schema = { components: {}, slots: {}, tools: {}, version: 1, views: {} };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSchema.mockResolvedValue(schema);
});
afterEach(() => vi.restoreAllMocks());

const waitForAbort = async (_host: string, signal: AbortSignal) =>
  await (async () => {
    const {
      promise: pendingPromise,
      resolve: _resolve,
      reject,
    } = Promise.withResolvers<never>();
    try {
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
        },
        {
          once: true,
        }
      );
    } catch (error) {
      reject(error);
    }
    return await pendingPromise;
  })();

describe("AI SDK terminal transport", () => {
  it("forwards the SDK's complete history and abort signal to the host client", async () => {
    const chat = vi.fn(
      // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
      async (
        _input: Parameters<TailorKitRouterClient["appAgent"]["chat"]>[0],
        _options?: Parameters<TailorKitRouterClient["appAgent"]["chat"]>[1]
      ) => chatEvents()
    );
    await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
    const [options] = requireValue(mocks.tui.mock.lastCall);
    expect(options).toMatchObject({
      reasoning: "hidden",
      title: `TailorKit Agent · ${hostUrl}`,
      tools: "collapsed",
    });
    const controller = new AbortController();
    const stream = await options.transport.sendMessages({
      abortSignal: controller.signal,
      chatId: "sdk-chat-id",
      messageId: undefined,
      messages,
      trigger: "submit-message",
    });
    let answer;
    for await (const message of readUIMessageStream({
      stream,
      terminateOnError: true,
    })) {
      answer = message;
    }
    expect(answer).toMatchObject({
      id: "run-2",
      parts: [{ text: "Continued", type: "text" }],
    });
    expect(mocks.fetchSchema).toHaveBeenCalledExactlyOnceWith(
      hostUrl,
      expect.any(AbortSignal)
    );
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.

    const schemaSignal =
      /* oxlint-disable typescript/no-unsafe-type-assertion -- The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below. */
      requireValue(mocks.fetchSchema.mock.calls[0])[1] as AbortSignal;
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    expect(schemaSignal.aborted).toBe(false);
    expect(chat).toHaveBeenCalledWith(
      { appId, hostUrl, messages, schema, threadId: undefined },
      { signal: controller.signal }
    );

    const updatedSchema = { ...schema, views: { "/detail": {} } };
    mocks.fetchSchema.mockResolvedValueOnce(updatedSchema);
    await options.transport.sendMessages({
      abortSignal: controller.signal,
      messages,
    });
    expect(chat).toHaveBeenLastCalledWith(
      {
        appId,
        hostUrl,
        messages,
        schema: updatedSchema,
        threadId: "e773a870-df5a-4bea-9ebd-9be4c0b1897a",
      },
      { signal: controller.signal }
    );
    controller.abort();
    expect(schemaSignal.aborted).toBe(true);
    expect(requireValue(chat.mock.calls[0])[1]?.signal?.aborted).toBe(true);
    expect(
      await options.transport.reconnectToStream({ chatId: "sdk-chat-id" })
    ).toBeNull();
  });

  it("starts each CLI chat without a thread ID unless explicitly resumed", async () => {
    const chat = vi.fn(
      async (
        _input: Parameters<TailorKitRouterClient["appAgent"]["chat"]>[0]
      ) => await Promise.resolve(chatEvents())
    );
    await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
    const first = requireValue(mocks.tui.mock.lastCall)[0].transport;
    const stream = await first.sendMessages({ messages });
    for await (const _ of stream) {
      /* consume */
    }
    expect(requireValue(chat.mock.calls[0])[0].threadId).toBeUndefined();
    await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
    await requireValue(mocks.tui.mock.lastCall)[0].transport.sendMessages({
      messages,
    });
    expect(requireValue(chat.mock.lastCall)[0].threadId).toBeUndefined();
    const threadId = "e773a870-df5a-4bea-9ebd-9be4c0b1897a";
    await openAgentTui({
      appId,
      client: { appAgent: { chat } },
      hostUrl,
      threadId,
    });
    await requireValue(mocks.tui.mock.lastCall)[0].transport.sendMessages({
      messages,
    });
    expect(requireValue(chat.mock.lastCall)[0].threadId).toBe(threadId);
  });

  it.each([new Error("Local host unavailable"), "Local host unavailable"])(
    "reports schema fetch failures with their cause and does not start a remote run: %s",
    async (cause: unknown) => {
      const chat = vi.fn();
      mocks.fetchSchema.mockRejectedValueOnce(cause);
      await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
      await expect(
        requireValue(mocks.tui.mock.lastCall)[0].transport.sendMessages({
          messages,
        })
      ).rejects.toMatchObject({
        cause,
        message: `Unable to fetch the host schema from ${hostUrl}: Local host unavailable`,
      });
      expect(chat).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, new AbortController().signal])(
    "times out a stalled schema fetch, with user signal %s, before starting a remote run",
    async (abortSignal) => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      const timeoutSpy = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation(() => timeout(1));
      mocks.fetchSchema.mockImplementationOnce(waitForAbort);
      const chat = vi.fn();
      await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
      await expect(
        requireValue(mocks.tui.mock.lastCall)[0].transport.sendMessages({
          abortSignal,
          messages,
        })
      ).rejects.toMatchObject({
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matchers intentionally return any; this value is used only to describe an assertion, not as application data.
        cause: expect.objectContaining({ name: "TimeoutError" }),
        message: `Unable to fetch the host schema from ${hostUrl}: Timed out after 10 seconds.`,
      });
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(chat).not.toHaveBeenCalled();
    }
  );

  it("honors user cancellation during a schema fetch without starting a remote run", async () => {
    mocks.fetchSchema.mockImplementationOnce(waitForAbort);
    const chat = vi.fn();
    const controller = new AbortController();
    await openAgentTui({ appId, client: { appAgent: { chat } }, hostUrl });
    const sending = requireValue(
      mocks.tui.mock.lastCall
    )[0].transport.sendMessages({
      abortSignal: controller.signal,
      messages,
    });
    const reason = new DOMException("Cancelled by user", "AbortError");
    const aborted = expect(sending).rejects.toBe(reason);
    controller.abort(reason);
    await aborted;
    expect(chat).not.toHaveBeenCalled();
  });
});
