import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AppAgentInput } from "./input";
import { appAgent } from "./workflows";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  load: vi.fn(),
  persist: vi.fn(),
  prepare: vi.fn(),
  release: vi.fn(),
  step: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("./agent-step", () => ({ agentStep: mocks.step }));

vi.mock("./sandbox", () => ({
  prepareSandboxStep: mocks.prepare,
  stopSandboxStep: mocks.stop,
}));

vi.mock("./session-store", () => ({
  cancelAppAgent: mocks.cancel,
  loadResumeStep: mocks.load,
  persistResumeStep: mocks.persist,
  releaseSessionStep: mocks.release,
}));

vi.mock("workflow", () => ({
  FatalError: class extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: "run-1" }),
}));

const input: AppAgentInput = {
  agentToken: "private-token",
  appId: "app-1",
  hostUrl: "https://host.test/api/patchsmith",
  messages: [{ content: "Build the app", role: "user" }],
  model: "xiaomi/mimo-v2.6-pro",
  threadId: "thread-1",
};

const resumeFrom = {
  data: { sessionFileName: "native-session.jsonl" },
  harnessId: "pi",
  specificationVersion: "harness-v1" as const,
  type: "resume-session" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({});
  mocks.step.mockResolvedValue({
    finalResult: { finishReason: "stop", sessionId: input.threadId },
    prompt: "",
    resumeFrom,
    sessionId: input.threadId,
    status: "finished",
  });
});

describe("durable Pi turns", () => {
  it("loads native history and saves the next handle before stopping and releasing the Drive", async () => {
    mocks.load.mockResolvedValue({
      resumeFrom,
      sandboxName: "agent-thread-thread-1",
    });
    const result = await appAgent(input);
    expect(result).toMatchObject({
      finishReason: "stop",
      threadId: input.threadId,
    });
    expect(mocks.step).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: input.messages,
        resumeFrom,
        sessionId: input.threadId,
      }),
      input,
      "run-1"
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      input.appId,
      input.threadId,
      "run-1",
      resumeFrom,
      "agent-thread-thread-1"
    );
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stop.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.release.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("passes the suspended turn to the next step without stopping its sandbox", async () => {
    const continueFrom = { ...resumeFrom, type: "continue-turn" };
    mocks.step.mockResolvedValueOnce({
      continueFrom,
      prompt: "",
      sessionId: input.threadId,
      status: "ready_for_next_step",
    });
    const result = await appAgent(input);
    expect(mocks.step).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ continueFrom, status: "ready_for_next_step" }),
      input,
      "run-1"
    );
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(result.finishReason).toBe("stop");
  });

  it("cleans up setup and runner failures without saving unusable handles", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Setup failed"));
    await expect(appAgent(input)).rejects.toThrow("Setup failed");
    expect(mocks.cancel).toHaveBeenCalledWith(input.appId, "run-1");
    expect(mocks.step).not.toHaveBeenCalled();
    mocks.step.mockResolvedValueOnce({
      error: "Bridge lost",
      prompt: "",
      sessionId: input.threadId,
      status: "failed",
    });
    await expect(appAgent(input)).rejects.toThrow("Bridge lost");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("does not start a sandbox when the exclusive lease is busy", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Already editing"));
    await expect(appAgent(input)).rejects.toThrow("Already editing");
    expect(mocks.prepare).not.toHaveBeenCalled();
    // Cleanup is owner-checked, so it cannot delete the active editor's VM.
    expect(mocks.cancel).toHaveBeenCalledWith(input.appId, "run-1");
  });

  it("retains resumability for a tool approval continuation", async () => {
    mocks.step.mockResolvedValueOnce({
      finalResult: { finishReason: "tool-calls", sessionId: input.threadId },
      prompt: "",
      resumeFrom: {
        ...resumeFrom,
        continueFrom: { ...resumeFrom, type: "continue-turn" },
      },
      sessionId: input.threadId,
      status: "awaiting_tool_approval",
    });
    await expect(appAgent(input)).resolves.toMatchObject({
      finishReason: "tool-calls",
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
});
