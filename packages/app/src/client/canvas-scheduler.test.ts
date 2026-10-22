import { expect, it, vi } from "vite-plus/test";

import { createCanvasFrameScheduler } from "./canvas-scheduler";
import type { CanvasWaitRequest } from "./canvas-scheduler";

it("waits for the matching host reply without scheduling an iframe timer", async () => {
  const send = vi.fn<(request: CanvasWaitRequest) => void>();
  const timer = vi.spyOn(globalThis, "setTimeout");
  const scheduler = createCanvasFrameScheduler(send);
  let completed = false;

  const wait = scheduler
    .wait(1000 / 35, new AbortController().signal)
    .then(() => {
      completed = true;
    });

  try {
    expect(send).toHaveBeenCalledExactlyOnceWith({
      delay: 29,
      sequence: 1,
      type: "wait",
    });
    expect(timer).not.toHaveBeenCalled();
    scheduler.receive(2);
    await Promise.resolve();
    expect(completed).toBe(false);
    scheduler.receive(1);
    await wait;
    expect(completed).toBe(true);
  } finally {
    timer.mockRestore();
  }
});

it("cancels a long wait and ignores its late reply when a replacement is pending", async () => {
  const send = vi.fn<(request: CanvasWaitRequest) => void>();
  const scheduler = createCanvasFrameScheduler(send);
  const lifetime = new AbortController();
  const first = scheduler.wait(Infinity, lifetime.signal);
  expect(send).toHaveBeenLastCalledWith({
    delay: 2_147_483_647,
    sequence: 1,
    type: "wait",
  });
  lifetime.abort();
  await first;
  expect(send).toHaveBeenLastCalledWith({ sequence: 1, type: "cancelWait" });
  let completed = false;

  const next = scheduler.wait(10, new AbortController().signal).then(() => {
    completed = true;
  });

  scheduler.receive(1);
  await Promise.resolve();
  expect(completed).toBe(false);
  scheduler.receive(2);
  await next;
  expect(completed).toBe(true);
});

it("rejects concurrent waits and settles pending work when the surface closes", async () => {
  const send = vi.fn<(request: CanvasWaitRequest) => void>();
  const scheduler = createCanvasFrameScheduler(send);
  const lifetime = new AbortController();
  lifetime.abort();
  await scheduler.wait(1, lifetime.signal);
  expect(send).not.toHaveBeenCalled();
  const first = scheduler.wait(10, new AbortController().signal);
  await expect(
    scheduler.wait(10, new AbortController().signal)
  ).rejects.toThrow("previous canvas pacing");
  const rejected = expect(first).rejects.toThrow("Revoked");
  scheduler.close(new Error("Revoked"));
  await rejected;
  await expect(
    scheduler.wait(10, new AbortController().signal)
  ).rejects.toThrow("Revoked");
});
