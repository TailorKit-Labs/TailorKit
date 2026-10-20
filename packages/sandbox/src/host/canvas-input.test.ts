// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";

import { createCanvasInput } from "./canvas-input";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const fixture = (policy: Parameters<typeof createCanvasInput>[2]) => {
  vi.useFakeTimers();
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 20, 640, 400)
  );
  const { port1, port2 } = new MessageChannel();
  const post = vi.spyOn(port1, "postMessage");
  const invalid = vi.fn<() => void>();
  const input = createCanvasInput(canvas, port1, policy, invalid);

  return {
    canvas,
    close: () => {
      input.close();
      port1.close();
      port2.close();
    },
    input,
    invalid,
    post,
  };
};

it("defaults to no input and never makes an output-only canvas focusable", async () => {
  const test = fixture({});

  try {
    test.canvas.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 30, clientY: 40 })
    );
    test.canvas.dispatchEvent(new Event("focus"));
    test.canvas.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(40);
    expect(test.post).not.toHaveBeenCalled();
    expect(test.canvas.hasAttribute("tabindex")).toBe(false);
  } finally {
    test.close();
  }
});

it("scales coordinates, coalesces movement, and waits for input acknowledgement", async () => {
  const test = fixture({ pointer: true });

  try {
    for (let index = 0; index < 1000; index += 1) {
      test.canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 330,
          clientY: 220,
          pointerId: 1,
          pointerType: "mouse",
        })
      );
    }

    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenCalledTimes(1);
    expect(test.post).toHaveBeenCalledWith({
      events: [
        {
          button: 0,
          buttons: 0,
          event: "pointermove",
          pointerId: 1,
          pointerType: "mouse",
          shiftKey: false,
          type: "pointer",
          x: 160,
          y: 100,
        },
      ],
      sequence: 1,
      type: "input",
    });
    test.canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 650,
        clientY: 420,
        pointerId: 1,
      })
    );
    await vi.advanceTimersByTimeAsync(40);
    expect(test.post).toHaveBeenCalledTimes(1);
    test.input.acknowledge(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenCalledTimes(2);
    test.input.acknowledge(99);
    expect(test.invalid).toHaveBeenCalledOnce();
  } finally {
    test.close();
  }
});

it("forwards only focused, approved keys and preserves browser shortcuts and Tab", async () => {
  const test = fixture({ keyboard: ["ArrowLeft"] });

  const key = (code: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      code,
      key: code,
      ...options,
    });

    test.canvas.dispatchEvent(event);

    return event;
  };

  try {
    expect(key("ArrowLeft").defaultPrevented).toBe(false);
    test.canvas.focus();
    expect(key("Tab").defaultPrevented).toBe(false);
    expect(key("KeyA").defaultPrevented).toBe(false);
    expect(key("ArrowLeft", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowLeft").defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenCalledExactlyOnceWith({
      events: [
        { type: "focus" },
        {
          code: "ArrowLeft",
          event: "keydown",
          key: "ArrowLeft",
          repeat: false,
          shiftKey: false,
          type: "key",
        },
      ],
      sequence: 1,
      type: "input",
    });
    test.input.acknowledge(1);
    test.canvas.blur();
    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenLastCalledWith({
      events: [{ type: "blur" }],
      sequence: 2,
      type: "input",
    });
    test.input.close();
    expect(test.canvas.hasAttribute("tabindex")).toBe(false);
  } finally {
    test.close();
  }
});

it("resets held input on bounded queue overflow and removes listeners on close", async () => {
  const test = fixture({ pointer: true });

  try {
    for (let index = 0; index < 63; index += 1) {
      test.canvas.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 1 })
      );
    }

    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenCalledExactlyOnceWith({
      events: [{ type: "blur" }],
      sequence: 1,
      type: "input",
    });
    test.input.close();
    test.canvas.dispatchEvent(new PointerEvent("pointermove"));
    await vi.advanceTimersByTimeAsync(40);
    expect(test.post).toHaveBeenCalledTimes(1);
  } finally {
    test.close();
  }
});

it("releases captured keys when modifiers change without suppressing shortcuts", async () => {
  const test = fixture({ keyboard: ["ArrowLeft"] });

  try {
    test.canvas.focus();
    test.canvas.dispatchEvent(
      new KeyboardEvent("keydown", { code: "ArrowLeft", key: "ArrowLeft" })
    );

    const release = new KeyboardEvent("keyup", {
      cancelable: true,
      code: "ArrowLeft",
      ctrlKey: true,
      key: "ArrowLeft",
    });

    test.canvas.dispatchEvent(release);
    expect(release.defaultPrevented).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(test.post).toHaveBeenCalledExactlyOnceWith({
      events: [
        { type: "focus" },
        {
          code: "ArrowLeft",
          event: "keydown",
          key: "ArrowLeft",
          repeat: false,
          shiftKey: false,
          type: "key",
        },
        {
          code: "ArrowLeft",
          event: "keyup",
          key: "ArrowLeft",
          repeat: false,
          shiftKey: false,
          type: "key",
        },
      ],
      sequence: 1,
      type: "input",
    });
  } finally {
    test.close();
  }
});
