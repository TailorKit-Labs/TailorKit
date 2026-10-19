import { expect, it, vi } from "vite-plus/test";

import type { experimental_CanvasSurface } from "./canvas";
import { createCanvasController } from "./canvas-controller";

const createSurface = () => {
  const lifetime = new AbortController();
  // SAFETY: This injected controller fixture uses only EventTarget; real OffscreenCanvas drawing is covered by the browser harness.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- No graphics operations are performed on this lifecycle test fixture.
  const canvas = new EventTarget() as OffscreenCanvas;
  const present = vi
    .fn<experimental_CanvasSurface["present"]>()
    .mockResolvedValue();
  const close = vi.fn(() => {
    lifetime.abort(new Error("Closed"));
  });
  const surface: experimental_CanvasSurface = {
    canvas,
    close,
    present,
    signal: lifetime.signal,
  };
  return { lifetime, surface };
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const createBridge = () => {
  let listener: ((generation: string | null) => void) | null = null;
  const surfaces: ReturnType<typeof createSurface>[] = [];
  const request = vi.fn(async () => {
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
      dispose,
      draw: (resource) => {
        resource.value = 1;
        values.push(resource.value);
      },
      setup,
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
      dispose,
      draw: (resource) => {
        resource.value = 2;
        values.push(resource.value);
      },
      setup,
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
      dispose,
      draw,
      setup: async (_canvas, context) => {
        signals.push(context.signal);
        return await promise;
      },
    },
    [],
    {}
  );
  const unmount = controller.mount();
  bridge.availability("first");
  await settle();
  unmount();
  expect(signals[0]?.aborted).toBe(true);
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
      dispose,
      draw: () => {},
      setup: async (_canvas, { signal }) => {
        signals.push(signal);
        return await pending.promise;
      },
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
