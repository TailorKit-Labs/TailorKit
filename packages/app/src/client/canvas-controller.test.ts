import { expect, it, vi } from "vite-plus/test";

import type { experimental_CanvasSurface } from "./canvas";
import { createCanvasController } from "./canvas-controller";
import type { experimental_CanvasHookState } from "./canvas-controller";
import { createCanvasFrameScheduler } from "./canvas-scheduler";

const createSurface = () => {
  const lifetime = new AbortController();
  const target = Object.assign(new EventTarget(), { height: 200, width: 320 });
  // SAFETY: The controller fixture needs only events and dimensions; real drawing is covered by the browser harness.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- No graphics operations are performed on this lifecycle fixture.
  const canvas = target as OffscreenCanvas;

  const present = vi
    .fn<experimental_CanvasSurface["present"]>()
    .mockResolvedValue();

  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const pacing = createCanvasFrameScheduler((message) => {
    if (message.type === "cancelWait") {
      clearTimeout(timers.get(message.sequence));
      timers.delete(message.sequence);
    } else {
      timers.set(
        message.sequence,
        setTimeout(() => {
          timers.delete(message.sequence);
          pacing.receive(message.sequence);
        }, message.delay)
      );
    }
  });

  const close = vi.fn(() => {
    pacing.close(new Error("Closed"));

    for (const timer of timers.values()) {
      clearTimeout(timer);
    }

    timers.clear();
    lifetime.abort(new Error("Closed"));
  });

  const surface: experimental_CanvasSurface = {
    canvas,
    close,
    present,
    signal: lifetime.signal,
    waitForFrame: pacing.wait,
  };

  return { lifetime, surface };
};

const settle = async () => {
  for (let index = 0; index < 16; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Drain the controller's serialized async lifecycle and presentation steps.
    await Promise.resolve();
  }
};

const createBridge = () => {
  let listener: ((generation: string | null) => void) | null = null;
  const surfaces: ReturnType<typeof createSurface>[] = [];

  const request = vi.fn(async () => {
    if (surfaces.some(({ surface }) => !surface.signal.aborted)) {
      throw new Error("Canvas surface is already connected.");
    }

    const next = createSurface();
    surfaces.push(next);

    return await Promise.resolve(next.surface);
  });

  return {
    availability: (generation: string | null) => listener?.(generation),
    dependencies: {
      request,
      watch: (_name: string, next: (generation: string | null) => void) => {
        listener = next;

        return () => {
          listener = null;
        };
      },
    },
    surfaces,
  };
};

it("sets up once, uses fresh update closures, and disposes on replacement and unmount", async () => {
  const bridge = createBridge();
  const setup = vi.fn(() => ({ value: 0 }));
  const dispose = vi.fn<(resource: number | { value: number }) => void>();
  const values: number[] = [];

  const controller = createCanvasController<{ value: number }>(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    {
      create: setup,
      dispose,
      update: (resource) => {
        resource.value = 1;
        values.push(resource.value);
      },
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  expect(setup).toHaveBeenCalledTimes(1);
  expect(values).toEqual([1]);
  controller.update(
    {
      create: setup,
      dispose,
      update: (resource) => {
        resource.value = 2;
        values.push(resource.value);
      },
    },
    [2],
    {}
  );
  await settle();
  expect(values).toEqual([1, 2]);
  expect(setup).toHaveBeenCalledTimes(1);
  bridge.availability("resized");
  await settle();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(setup).toHaveBeenCalledTimes(2);
  unmount();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("aborts an async setup and disposes its late result without drawing", async () => {
  const bridge = createBridge();
  const { promise, resolve } = Promise.withResolvers<number>();
  const dispose = vi.fn<(resource: number | { value: number }) => void>();
  const draw = vi.fn<(resource: number, canvas: OffscreenCanvas) => void>();
  const signals: AbortSignal[] = [];

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    {
      create: async (_canvas, context) => {
        signals.push(context.signal);

        return await promise;
      },
      dispose,
      draw,
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  unmount();
  expect(signals[0]?.aborted).toBe(true);
  expect(bridge.surfaces[0]?.surface.close).toHaveBeenCalled();
  resolve(42);
  await settle();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(42);
  expect(draw).not.toHaveBeenCalled();
  expect(bridge.surfaces[0]?.surface.close).toHaveBeenCalled();
});

it("reconnects once after closure, bounds automatic retries, and allows explicit retry", async () => {
  vi.useFakeTimers();
  const bridge = createBridge();

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(() => {}, [], {});
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    bridge.surfaces[0]?.lifetime.abort(new Error("Presentation timed out"));
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(bridge.dependencies.request).toHaveBeenCalledTimes(2);
    bridge.surfaces[1]?.lifetime.abort(
      new Error("Presentation timed out again")
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.dependencies.request).toHaveBeenCalledTimes(2);
    controller.retry();
    await settle();
    expect(bridge.dependencies.request).toHaveBeenCalledTimes(3);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("does not let an old pending draw block the replacement surface", async () => {
  const bridge = createBridge();
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let calls = 0;

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    async () => {
      calls += 1;

      if (calls === 1) {
        await promise;
      }
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  bridge.availability("second");
  await settle();
  expect(bridge.surfaces[1]?.surface.present).toHaveBeenCalledWith({
    preserveDrawingBuffer: true,
  });
  resolve(true);
  await settle();
  expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
  unmount();
});

it("aborts setup on connection loss and disposes the late resource", async () => {
  vi.useFakeTimers();
  const bridge = createBridge();
  const pending = Promise.withResolvers<number>();
  const signals: AbortSignal[] = [];
  const dispose = vi.fn<(value: number) => void>();

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    {
      create: async (_canvas, { signal }) => {
        signals.push(signal);

        return await pending.promise;
      },
      dispose,
      draw: () => {},
    },
    [],
    {}
  );
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    bridge.surfaces[0]?.lifetime.abort(new Error("Closed during setup"));
    expect(signals[0]?.aborted).toBe(true);
    unmount();
    pending.resolve(10);
    await settle();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bridge.dependencies.request).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("reconnects when effects remount the same controller and ignores retries after teardown", async () => {
  const bridge = createBridge();

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(() => {}, [], {});
  const firstUnmount = controller.mount();
  bridge.availability("first");
  await settle();
  firstUnmount();
  const secondUnmount = controller.mount();
  bridge.availability("first");
  await settle();
  expect(bridge.dependencies.request).toHaveBeenCalledTimes(2);
  secondUnmount();
  controller.retry();
  await settle();
  expect(bridge.dependencies.request).toHaveBeenCalledTimes(2);
});

it("orders create, resize, update, draw and only updates data when dependencies change", async () => {
  const bridge = createBridge();
  const calls: string[] = [];

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  const definition = {
    create: () => {
      calls.push("create");

      return 1;
    },
    dispose: () => {
      calls.push("dispose");
    },
    draw: () => {
      calls.push("draw");
    },
    resize: (_resource: number, size: { width: number; height: number }) => {
      calls.push(`resize:${size.width}x${size.height}`);
    },
    update: () => {
      calls.push("update");
    },
  };

  controller.update(definition, [1], {});
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  expect(calls).toEqual(["create", "resize:320x200", "update", "draw"]);
  controller.invalidate();
  controller.invalidate();
  await settle();
  expect(calls).toEqual(["create", "resize:320x200", "update", "draw", "draw"]);
  bridge.surfaces[0]?.surface.canvas.dispatchEvent(new Event("pointermove"));
  await settle();
  expect(calls.filter((call) => call === "update")).toHaveLength(1);
  controller.update(definition, [1], {});
  await settle();
  expect(calls.filter((call) => call === "draw")).toHaveLength(3);
  controller.update(definition, [2], {});
  await settle();
  expect(calls.slice(-2)).toEqual(["update", "draw"]);
  bridge.availability("resized");
  await settle();
  expect(calls.slice(-5)).toEqual([
    "dispose",
    "create",
    "resize:320x200",
    "update",
    "draw",
  ]);
  unmount();
  expect(calls.at(-1)).toBe("dispose");
});

it("recreates only on creation dependencies and ignores invalidation from retired resources", async () => {
  const bridge = createBridge();
  const invalidations: (() => void)[] = [];

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  const create = vi.fn(
    (_canvas: OffscreenCanvas, context: { invalidate: () => void }) => {
      invalidations.push(context.invalidate);

      return invalidations.length;
    }
  );

  const dispose = vi.fn<(value: number) => void>();
  const update = vi.fn<(value: number) => void>();
  const definition = { create, dispose, update };
  controller.update(definition, [1], { createDependencies: ["bar"] });
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  controller.update(definition, [2], { createDependencies: ["bar"] });
  await settle();
  expect(create).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(2);
  controller.update(definition, [2], { createDependencies: ["line"] });
  await settle();
  expect(create).toHaveBeenCalledTimes(2);
  expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
  expect(update).toHaveBeenLastCalledWith(
    2,
    bridge.surfaces[1]?.surface.canvas
  );
  invalidations[0]?.();
  await settle();
  expect(bridge.surfaces[1]?.surface.present).toHaveBeenCalledTimes(1);
  invalidations[1]?.();
  await settle();
  expect(bridge.surfaces[1]?.surface.present).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledTimes(3);
  unmount();
});

it("serializes async updates and applies the latest dependencies before the next draw", async () => {
  const bridge = createBridge();
  const pending = Promise.withResolvers<boolean>();
  const calls: string[] = [];

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    {
      create: () => 1,
      draw: () => {
        calls.push("draw");
      },
      update: async () => {
        calls.push("old");
        await pending.promise;
      },
    },
    [1],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  controller.update(
    {
      create: () => 1,
      draw: () => {
        calls.push("draw");
      },
      update: () => {
        calls.push("new");
      },
    },
    [2],
    {}
  );
  await settle();
  expect(calls).toEqual(["old"]);
  pending.resolve(true);
  await settle();
  expect(calls).toEqual(["old", "new", "draw"]);
  unmount();
});

it("disposes a created resource if resize fails", async () => {
  const bridge = createBridge();
  const failure = new Error("Resize failed");
  const notify = vi.fn<(state: experimental_CanvasHookState) => void>();
  const dispose = vi.fn<(value: number) => void>();

  const controller = createCanvasController<number>(
    "chart",
    notify,
    bridge.dependencies
  );

  controller.update(
    {
      create: () => 42,
      dispose,
      resize: () => {
        throw failure;
      },
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(42);
  expect(notify).toHaveBeenLastCalledWith({ error: failure, status: "error" });
  expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
  unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it("cancels pending resize and disposes its resource without presenting after teardown", async () => {
  const bridge = createBridge();
  const pending = Promise.withResolvers<boolean>();
  const dispose = vi.fn<(value: number) => void>();
  const update = vi.fn<(value: number) => void>();
  const signals: AbortSignal[] = [];

  const controller = createCanvasController<number>(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    {
      create: (_canvas, { signal }) => {
        signals.push(signal);

        return 7;
      },
      dispose,
      resize: async () => {
        await pending.promise;
      },
      update,
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  unmount();
  expect(signals[0]?.aborted).toBe(true);
  expect(bridge.surfaces[0]?.surface.close).toHaveBeenCalled();
  pending.resolve(true);
  await settle();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(7);
  expect(update).not.toHaveBeenCalled();
  expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
});

it("skips snapshots on false and presents again on explicit invalidation", async () => {
  const bridge = createBridge();
  let skip = true;

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(() => !skip, [], {});
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
  skip = false;
  controller.invalidate();
  await settle();
  expect(bridge.surfaces[0]?.surface.present).toHaveBeenCalledTimes(1);
  unmount();
});

it("paces skipped library frames, supplies timing, and cancels waits on unmount", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const bridge = createBridge();
  const frames: { timestamp: number; deltaTime: number }[] = [];

  const controller = createCanvasController<number>("chart", () => {}, {
    ...bridge.dependencies,
    now: Date.now,
  });

  controller.update(
    {
      create: () => 1,
      draw: async (_resource, _canvas, frame) => {
        frames.push(frame);
        await Promise.resolve();

        return false;
      },
    },
    [],
    { continuous: true, framesPerSecond: 20 }
  );
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    expect(frames).toEqual([{ deltaTime: 0, timestamp: 1000 }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(frames).toEqual([
      { deltaTime: 0, timestamp: 1000 },
      { deltaTime: 50, timestamp: 1050 },
      { deltaTime: 50, timestamp: 1100 },
    ]);
    expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(frames).toHaveLength(3);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("yields skipped continuous frames even without a requested rate", async () => {
  vi.useFakeTimers();
  const bridge = createBridge();
  let draws = 0;

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(
    () => {
      draws += 1;

      return false;
    },
    [],
    { continuous: true }
  );
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    expect(draws).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(draws).toBeGreaterThan(1);
    expect(draws).toBeLessThanOrEqual(7);
    expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("coalesces redraws under the requested cap and resets timing on replacement", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const bridge = createBridge();
  const frames: { timestamp: number; deltaTime: number }[] = [];

  const controller = createCanvasController("chart", () => {}, {
    ...bridge.dependencies,
    now: Date.now,
  });

  controller.update(
    (_canvas, frame) => {
      frames.push(frame);
    },
    [],
    { framesPerSecond: 20 }
  );
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    controller.invalidate();
    controller.invalidate();
    await settle();
    await vi.advanceTimersByTimeAsync(49);
    expect(frames).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(frames).toEqual([
      { deltaTime: 0, timestamp: 1000 },
      { deltaTime: 50, timestamp: 1050 },
    ]);
    expect(bridge.surfaces[0]?.surface.present).toHaveBeenCalledTimes(2);
    controller.invalidate();
    await settle();
    bridge.availability("replacement");
    await settle();
    expect(frames.at(-1)).toEqual({ deltaTime: 0, timestamp: 1050 });
    await vi.advanceTimersByTimeAsync(100);
    expect(bridge.surfaces[0]?.surface.present).toHaveBeenCalledTimes(2);
    expect(bridge.surfaces[1]?.surface.present).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("rejects invalid requested frame rates before starting a connection", () => {
  const bridge = createBridge();

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  for (const framesPerSecond of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    241,
  ]) {
    expect(() => {
      controller.update(() => {}, [], { framesPerSecond });
    }).toThrow(RangeError);
  }

  expect(bridge.dependencies.request).not.toHaveBeenCalled();
});

it("does not overflow timers for very low requested rates", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const bridge = createBridge();
  let draws = 0;

  const controller = createCanvasController("chart", () => {}, {
    ...bridge.dependencies,
    now: Date.now,
  });

  controller.update(
    () => {
      draws += 1;
    },
    [],
    { framesPerSecond: 0.0000001 }
  );
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    controller.invalidate();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(draws).toBe(1);
    unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("notifies ready only on connection or recovery, even with fresh dependency identities", async () => {
  const bridge = createBridge();
  const notify = vi.fn<(state: experimental_CanvasHookState) => void>();

  const controller = createCanvasController(
    "chart",
    notify,
    bridge.dependencies
  );

  const draw = vi.fn(() => {});
  controller.update(draw, [{}], {});
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    controller.update(draw, [{}], {});
    await settle();
    controller.update(draw, [{}], {});
    await settle();
    expect(draw).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls.map(([state]) => state.status)).toEqual([
      "pending",
      "ready",
    ]);
    draw.mockImplementationOnce(() => {
      throw new Error("Draw failed");
    });
    controller.invalidate();
    await settle();
    expect(notify.mock.calls.at(-1)?.[0].error).toBeInstanceOf(Error);
    expect(notify.mock.calls.at(-1)?.[0].status).toBe("error");
    controller.update(draw, [{}], {});
    await settle();
    expect(notify).toHaveBeenLastCalledWith({ error: null, status: "ready" });
    expect(notify).toHaveBeenCalledTimes(4);
  } finally {
    unmount();
  }
});

it.each([false, true])(
  "wakes a very slow pacing wait when the cap increases (continuous: %s)",
  async (continuous) => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const bridge = createBridge();
    const draw = vi.fn(() => !continuous);

    const controller = createCanvasController("chart", () => {}, {
      ...bridge.dependencies,
      now: Date.now,
    });

    controller.update(draw, [], { continuous, framesPerSecond: 0.0000001 });
    const unmount = controller.mount();

    try {
      bridge.availability("first");
      await settle();
      controller.invalidate();
      await settle();
      expect(draw).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      controller.update(draw, [], { continuous, framesPerSecond: 60 });
      await settle();
      await vi.advanceTimersByTimeAsync(17);
      expect(draw).toHaveBeenCalledTimes(2);
      expect(bridge.dependencies.request).toHaveBeenCalledTimes(1);
      unmount();
      await settle();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  }
);

it("wakes a pending redraw when the app removes its FPS cap", async () => {
  vi.useFakeTimers();
  const bridge = createBridge();
  const draw = vi.fn(() => {});

  const controller = createCanvasController(
    "chart",
    () => {},
    bridge.dependencies
  );

  controller.update(draw, [], { framesPerSecond: 0.0000001 });
  const unmount = controller.mount();

  try {
    bridge.availability("first");
    await settle();
    controller.invalidate();
    await settle();
    controller.update(draw, [], {});
    await settle();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it.each(["create", "resize"] as const)(
  "releases the granted surface before a pending %s settles so replacement can connect",
  async (stage) => {
    const bridge = createBridge();
    const pending = Promise.withResolvers<number>();
    const dispose = vi.fn<(resource: number) => void>();
    const notify = vi.fn<(state: experimental_CanvasHookState) => void>();

    const controller = createCanvasController<number>(
      "chart",
      notify,
      bridge.dependencies
    );

    controller.update(
      {
        create: async () => {
          if (stage === "create") {
            return await pending.promise;
          }

          return 1;
        },
        dispose,
        resize: async () => {
          if (stage === "resize") {
            await pending.promise;
          }
        },
      },
      [],
      { createDependencies: ["old"] }
    );
    const unmount = controller.mount();

    try {
      bridge.availability("first");
      await settle();
      controller.update({ create: () => 2, dispose }, [], {
        createDependencies: ["new"],
      });
      await settle();
      expect(bridge.surfaces[0]?.surface.signal.aborted).toBe(true);
      expect(bridge.surfaces[1]?.surface.present).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenLastCalledWith({ error: null, status: "ready" });
      pending.resolve(1);
      await settle();
      expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
      expect(bridge.surfaces[0]?.surface.present).not.toHaveBeenCalled();
      expect(bridge.surfaces[1]?.surface.signal.aborted).toBe(false);
    } finally {
      unmount();
    }
  }
);
