import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { ContextManager } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getTraceId, logger } from "./logging";

afterEach(() => {
  context.disable();
  vi.restoreAllMocks();
});

describe("structured logging", () => {
  it.each(["info", "warn", "error"] as const)(
    "writes %s events without requiring tracing initialization",
    (level) => {
      const output = vi.spyOn(console, level).mockImplementation(() => {});
      logger[level]("workflow.step_started", { attempt: 2, runId: "run-1" });
      expect(output).toHaveBeenCalledOnce();
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
        attempt: 2,
        event: "workflow.step_started",
        level,
        runId: "run-1",
      });
      expect(getTraceId()).toBeUndefined();
    }
  );

  it("correlates logs with the active OpenTelemetry span", () => {
    const traceId = "12345678901234567890123456789012";
    const active = trace.setSpanContext(ROOT_CONTEXT, {
      spanId: "1234567890123456",
      traceFlags: 1,
      traceId,
    });
    // Supply a context manager through OTel's public API, without an exporter.
    const manager: ContextManager = {
      active: () => active,
      bind: (_context, target) => target,
      disable() {
        return this;
      },
      enable() {
        return this;
      },
      with: (_context, fn, thisArg, ...args) => fn.apply(thisArg, args),
    };
    expect(context.setGlobalContextManager(manager)).toBe(true);
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("workflow.step_completed", { durationMs: 42 });
    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      durationMs: 42,
      event: "workflow.step_completed",
      level: "info",
      traceId,
    });
    expect(getTraceId()).toBe(traceId);
  });
});
