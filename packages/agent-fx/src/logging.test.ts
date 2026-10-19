import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { logWorkflowEvent, withStepLogging } from "./logging";

const context = {
  appId: "app-1",
  attempt: 2,
  phase: "agent" as const,
  runId: "wrun-1",
  stepId: "step-1",
  threadId: "thread-1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workflow logging", () => {
  it("logs a step's lifecycle and returns its result without a runtime context", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = { resumeFrom: "private-checkpoint" };
    const { promise, resolve } = Promise.withResolvers<typeof result>();
    const execution = withStepLogging(context, async (step) => {
      expect(info).toHaveBeenCalledOnce();
      expect(step).toMatchObject(context);
      return await promise;
    });
    resolve(result);
    await expect(execution).resolves.toBe(result);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('"event":"step_started"')
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"event":"step_completed"')
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"durationMs":')
    );
    expect(info.mock.calls.flat().join(",")).not.toContain(
      "private-checkpoint"
    );
    expect(failure).not.toHaveBeenCalled();
  });

  it.each([new Error("Bearer private-token"), "private-response"])(
    "logs a failed attempt and rethrows the original value: %s",
    async (cause) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const failure = vi.spyOn(console, "error").mockImplementation(() => {});
      const { promise, reject } = Promise.withResolvers<never>();
      const execution = withStepLogging(context, async () => await promise);
      reject(cause);
      await expect(execution).rejects.toBe(cause);
      expect(info).toHaveBeenCalledOnce();
      expect(failure).toHaveBeenCalledOnce();
      expect(failure).toHaveBeenCalledWith(
        expect.stringContaining('"event":"step_failed"')
      );
      expect(failure).toHaveBeenCalledWith(
        expect.stringContaining('"attempt":2')
      );
      expect(failure.mock.calls.flat().join(",")).not.toContain("private");
    }
  );

  it("allowlists correlation fields even when the caller passes an input object", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const input = {
      ...context,
      agentToken: "private-token",
      messages: [{ content: "private-prompt" }],
      resumeFrom: { data: "private-session" },
    };
    logWorkflowEvent("run_started", input);
    expect(info).toHaveBeenCalledWith(
      JSON.stringify({
        appId: context.appId,
        attempt: context.attempt,
        event: "run_started",
        phase: context.phase,
        runId: context.runId,
        stepId: context.stepId,
        threadId: context.threadId,
        workflow: "appAgent",
      })
    );
  });

  it("reports a failed harness checkpoint at error level even if the step returns", () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    logWorkflowEvent("agent_checkpoint", { ...context, status: "failed" });
    expect(failure).toHaveBeenCalledWith(
      expect.stringContaining('"status":"failed"')
    );
  });
});
