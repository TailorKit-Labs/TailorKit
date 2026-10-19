import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProgressReporter, createProgressSnapshot } from "./mcp-progress";
import type { AppAgentMcpEvent } from "./mcp-progress";

type ProgressSnapshot = Parameters<
  Parameters<typeof createProgressReporter>[0]
>[0];
type Chunk = Extract<AppAgentMcpEvent, { status: "streaming" }>["chunk"];

const identity = { appId: "app", runId: "run", threadId: "thread" };
const event = (chunk: Chunk): AppAgentMcpEvent => ({
  ...identity,
  chunk,
  status: "streaming",
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) {
    close();
  }
  vi.useRealTimers();
});

const reporter = () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const updates: ProgressSnapshot[] = [];
  const controller = new AbortController();
  const progress = createProgressReporter(async (update) => {
    await Promise.resolve(updates.push(update));
  }, controller.signal);
  cleanups.push(progress.close);
  return { controller, progress, updates };
};

describe("compact MCP progress", () => {
  it("coalesces text to the latest snapshot every 750ms and skips duplicates", async () => {
    const { progress, updates } = reporter();
    await progress.onProgress(
      event({ delta: "Building", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: " the", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: " app", id: "text", type: "text-delta" })
    );
    expect(updates.map(({ message }) => message)).toEqual(["Building"]);
    await vi.advanceTimersByTimeAsync(749);
    expect(updates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates.map(({ message }) => message)).toEqual([
      "Building",
      "Building the app",
    ]);
    await progress.onProgress(
      event({ delta: "", id: "text", type: "text-delta" })
    );
    await progress.flush();
    expect(updates).toHaveLength(2);
  });

  it("flushes pending text before tool changes and sends failures immediately", async () => {
    const { progress, updates } = reporter();
    await progress.onProgress(
      event({ delta: "Checking", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: " your app", id: "text", type: "text-delta" })
    );
    const tool: Chunk = {
      input: { command: "pnpm check" },
      toolCallId: "check",
      toolName: "bash",
      type: "tool-input-available",
    };
    await progress.onProgress(event(tool));
    await progress.onProgress(event(tool));
    await progress.onProgress(
      event({
        output: { exitCode: 1, stderr: "Private diagnostics" },
        toolCallId: "check",
        type: "tool-output-available",
      })
    );
    expect(updates.map(({ message }) => message)).toEqual([
      "Checking",
      "Checking your app",
      "Bash: pnpm check",
      "failed: Bash: pnpm check",
    ]);
    expect(updates.at(-1)?.activity).toMatchObject({
      outcome: "failed",
      status: "tool",
      toolCallId: "check",
    });
    expect(JSON.stringify(updates)).not.toContain("Private diagnostics");
  });

  it.each(["text-end", "finish", "error", "abort"] as const)(
    "flushes buffered text before %s without waiting for the timer",
    async (type) => {
      const { progress, updates } = reporter();
      await progress.onProgress(
        event({ delta: "Done", id: "text", type: "text-delta" })
      );
      await progress.onProgress(
        event({ delta: " building", id: "text", type: "text-delta" })
      );
      if (type === "text-end") {
        await progress.onProgress(event({ id: "text", type }));
      } else if (type === "error") {
        await progress.onProgress(
          event({ errorText: "Internal failure", type })
        );
      } else {
        await progress.onProgress(event({ type }));
      }
      expect(updates[1]?.message).toBe("Done building");
      expect(JSON.stringify(updates)).not.toContain("Internal failure");
    }
  );

  it("flushes the final pending snapshot even without a text-end chunk", async () => {
    const { progress, updates } = reporter();
    await progress.onProgress(
      event({ delta: "Done", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: ".", id: "text", type: "text-delta" })
    );
    await progress.flush();
    progress.close();
    expect(updates.at(-1)?.message).toBe("Done.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends a sparse progress heartbeat during quiet work and stops on close", async () => {
    const { progress, updates } = reporter();
    await progress.onProgress({ ...identity, status: "started" });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(updates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual(updates[0]);
    progress.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updates).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards buffered notifications and clears timers on cancellation", async () => {
    const { controller, progress, updates } = reporter();
    await progress.onProgress(
      event({ delta: "Building", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: " more", id: "text", type: "text-delta" })
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updates).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      progress.onProgress({ ...identity, status: "started" })
    ).rejects.toThrow();
  });

  it("propagates timer-triggered notification failures on the final flush", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let calls = 0;
    const progress = createProgressReporter(async () => {
      await Promise.resolve();
      calls += 1;
      if (calls > 1) {
        throw new Error("Disconnected");
      }
    }, new AbortController().signal);
    cleanups.push(progress.close);
    await progress.onProgress(
      event({ delta: "Building", id: "text", type: "text-delta" })
    );
    await progress.onProgress(
      event({ delta: " more", id: "text", type: "text-delta" })
    );
    await vi.advanceTimersByTimeAsync(750);
    await expect(progress.flush()).rejects.toThrow("Disconnected");
  });

  it("omits reasoning, partial arguments, preliminary results, and bookkeeping", () => {
    const snapshot = createProgressSnapshot();
    const chunks: Chunk[] = [
      { id: "reason", type: "reasoning-start" },
      { delta: "Private reasoning", id: "reason", type: "reasoning-delta" },
      {
        inputTextDelta: "Huge input".repeat(10_000),
        toolCallId: "tool",
        type: "tool-input-delta",
      },
      {
        output: "Huge output".repeat(10_000),
        preliminary: true,
        toolCallId: "tool",
        type: "tool-output-available",
      },
      { id: "text", type: "text-start" },
      { type: "start-step" },
      { type: "finish-step" },
    ];
    for (const chunk of chunks) {
      expect(snapshot(event(chunk))).toBeUndefined();
    }
  });

  it("bounds text and tool details while preserving tool outcomes", () => {
    const snapshot = createProgressSnapshot();
    const text = snapshot(
      event({
        delta: "Large text ".repeat(10_000),
        id: "text",
        type: "text-delta",
      })
    );
    expect(text?.message.length).toBeLessThanOrEqual(320);
    expect(text?.message).toMatch(/^…/u);
    const tool = snapshot(
      event({
        input: {
          command: "Long command ".repeat(1000),
          other: "Huge code".repeat(1000),
        },
        toolCallId: "tool",
        toolName: "bash",
        type: "tool-input-available",
      })
    );
    expect(tool?.message.length).toBeLessThanOrEqual(320);
    expect(JSON.stringify(tool).length).toBeLessThan(1000);
    const failed = snapshot(
      event({
        output: { isError: true },
        toolCallId: "tool",
        type: "tool-output-available",
      })
    );
    expect(failed?.activity).toMatchObject({ outcome: "failed" });
  });

  it("reports invalid tool input as failed without exposing input or diagnostics", () => {
    const snapshot = createProgressSnapshot();
    const failed = snapshot(
      event({
        errorText: "Private error",
        input: { command: "API_KEY=private-value command" },
        toolCallId: "tool",
        toolName: "bash",
        type: "tool-input-error",
      })
    );
    expect(failed?.activity).toMatchObject({
      outcome: "failed",
      status: "tool",
    });
    expect(JSON.stringify(failed)).not.toContain("private-value");
    expect(JSON.stringify(failed)).not.toContain("Private error");
  });
});
