// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";

import { createCanvasTarget } from "./canvas";

class Bitmap {
  width = 320;
  height = 200;
  close = vi.fn<() => void>();
}

type PresentationReply =
  | { sequence: number; type: "presented" }
  | { message: string; type: "closed" };

const fixture = (hidden: boolean) => {
  vi.useFakeTimers();
  vi.stubGlobal("ImageBitmap", Bitmap);

  const port = Object.assign(new EventTarget(), {
    close: vi.fn<() => void>(),
    postMessage: vi.fn<(message: PresentationReply) => void>(),
    start: vi.fn<() => void>(),
  });

  vi.stubGlobal(
    "MessageChannel",
    // oxlint-disable-next-line prefer-arrow-callback -- The host calls this with new; arrow functions are not constructors.
    vi.fn(function createChannel() {
      return { port1: port, port2: new EventTarget() };
    })
  );

  let visible = !hidden;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => !visible);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  const transfer = vi.fn<(bitmap: ImageBitmap | null) => void>();
  vi.spyOn(canvas, "getContext").mockReturnValue({
    canvas,
    transferFromImageBitmap: transfer,
  });
  const target = createCanvasTarget(canvas, { maxFramesPerSecond: 20 });
  target.connect();

  return {
    frame: (sequence: number) => {
      const bitmap = new Bitmap();
      port.dispatchEvent(
        new MessageEvent("message", {
          data: { bitmap, sequence, type: "frame" },
        })
      );

      return bitmap;
    },
    port,
    target,
    transfer,
    visibility: (next: boolean) => {
      visible = next;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("presents and acknowledges hidden-document frames while preserving the FPS gate", async () => {
  const test = fixture(true);

  try {
    const first = test.frame(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.transfer).toHaveBeenCalledExactlyOnceWith(first);
    expect(test.port.postMessage).toHaveBeenCalledWith({
      sequence: 1,
      type: "presented",
    });
    const second = test.frame(2);
    await vi.advanceTimersByTimeAsync(49);
    expect(test.transfer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.transfer).toHaveBeenLastCalledWith(second);
    expect(test.port.postMessage).toHaveBeenCalledWith({
      sequence: 2,
      type: "presented",
    });
  } finally {
    test.target.close();
  }
});

it("reschedules an outstanding animation frame when the document becomes hidden", async () => {
  const test = fixture(false);
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");

  try {
    const bitmap = test.frame(1);
    test.visibility(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.transfer).toHaveBeenCalledExactlyOnceWith(bitmap);
  } finally {
    test.target.close();
  }
});

it("cancels hidden presentation and releases the pending bitmap on revocation", async () => {
  const test = fixture(true);
  const bitmap = test.frame(1);
  test.target.close();
  expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  test.visibility(true);
  test.visibility(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(test.transfer).toHaveBeenCalledExactlyOnceWith(null);
  expect(test.port.close).toHaveBeenCalledTimes(1);
});
