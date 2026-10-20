import { createHarnessWorkflowState } from "@ai-sdk/workflow-harness";
import type { HarnessWorkflowChunk } from "@ai-sdk/workflow-harness";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { agentStep } from "./agent-step";
import type { AppAgentInput } from "./input";

const chunks: HarnessWorkflowChunk[] = [];
const mocks = vi.hoisted(() => ({
  continueStream: vi.fn(),
  createSession: vi.fn(),
  destroy: vi.fn(),
  detach: vi.fn(),
  removeToken: vi.fn(),
  renew: vi.fn(),
  stream: vi.fn(),
  suspend: vi.fn(),
  unfinished: vi.fn(),
}));
vi.mock("./agent", () => ({
  createAppAgent: () => ({
    continueStream: mocks.continueStream,
    createSession: mocks.createSession,
    stream: mocks.stream,
  }),
}));
vi.mock("./sandbox", () => ({
  getSandbox: vi.fn(),
  networkSession: vi.fn(),
  removeLegacyAgentToken: mocks.removeToken,
}));
vi.mock("./session-store", () => ({ renewSession: mocks.renew }));
vi.mock("workflow", () => ({
  getWritable: () =>
    new WritableStream<HarnessWorkflowChunk>({
      write(chunk) {
        chunks.push(chunk);
      },
    }),
}));

const input: AppAgentInput = {
  agentToken: "private-token",
  appId: "app-1",
  hostUrl: "https://host.test/api/patchsmith",
  messages: [{ content: "Build", role: "user" }],
  model: "xiaomi/mimo-v2.6-pro",
  threadId: "thread-1",
};
const resumeFrom = {
  data: {},
  harnessId: "pi",
  specificationVersion: "harness-v1" as const,
  type: "resume-session" as const,
};
const continueFrom = { ...resumeFrom, type: "continue-turn" as const };
const streamResult = (text: string) => ({
  finishReason: Promise.resolve("stop"),
  toUIMessageStream: () =>
    new ReadableStream<HarnessWorkflowChunk>({
      start(controller) {
        for (const chunk of [
          { messageId: "assistant-1", type: "start" },
          { id: "text-1", type: "text-start" },
          { delta: text, id: "text-1", type: "text-delta" },
          { id: "text-1", type: "text-end" },
          { type: "finish" },
        ]) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 2 }),
});

beforeEach(() => {
  vi.resetAllMocks();
  chunks.length = 0;
  mocks.createSession.mockResolvedValue({
    destroy: mocks.destroy,
    detach: mocks.detach,
    hasUnfinishedTurn: mocks.unfinished,
    suspendTurn: mocks.suspend,
  });
  mocks.detach.mockResolvedValue(resumeFrom);
  mocks.suspend.mockResolvedValue(continueFrom);
  mocks.unfinished.mockReturnValue(false);
  mocks.stream.mockResolvedValue(streamResult("Built"));
  mocks.continueStream.mockResolvedValue(streamResult("Continued"));
});

describe("Pi step with the SDK workflow runner", () => {
  it("sends converted messages once and emits valid UI chunks", async () => {
    const result = await agentStep(
      createHarnessWorkflowState({
        messages: input.messages,
        sessionId: input.threadId,
      }),
      input,
      "run-1"
    );
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({ messages: input.messages })
    );
    expect(result).toMatchObject({
      resumeFrom,
      status: "finished",
    });
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("continues an unfinished turn without replaying the user's prompt or a second message start", async () => {
    const state = {
      ...createHarnessWorkflowState({
        messages: input.messages,
        sessionId: input.threadId,
      }),
      continueFrom,
      messages: undefined,
    };
    const result = await agentStep(state, input, "run-1");
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ continueFrom, sessionId: input.threadId })
    );
    expect(mocks.continueStream).toHaveBeenCalledOnce();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(chunks.some((chunk) => chunk.type === "start")).toBe(false);
    expect(result.status).toBe("finished");
  });

  it("suspends unfinished work and leaves the sandbox available for another step", async () => {
    mocks.unfinished.mockReturnValue(true);
    const result = await agentStep(
      createHarnessWorkflowState({
        messages: input.messages,
        sessionId: input.threadId,
      }),
      input,
      "run-1"
    );
    expect(result).toMatchObject({
      continueFrom,
      status: "ready_for_next_step",
    });
    expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
    expect(mocks.detach).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});
