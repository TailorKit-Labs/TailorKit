import { useEffect, useId, useMemo, useState } from "preact/hooks";

import { experimental_requestCanvas } from "./canvas";
import type { experimental_CanvasSurface } from "./canvas";

export type experimental_CanvasDraw = (
  canvas: OffscreenCanvas
) => void | Promise<void>;
export interface experimental_CanvasHookOptions {
  continuous?: boolean;
}
export interface experimental_CanvasHookState {
  status: "pending" | "ready" | "error";
  error: Error | null;
}

const createController = (
  binding: string,
  notify: (state: experimental_CanvasHookState) => void
) => {
  let surface: experimental_CanvasSurface | null = null;
  let draw: experimental_CanvasDraw | null = null;
  let continuous = false;
  let mounted = false;
  let dirty = false;
  let failed = false;
  let running = false;
  let epoch = 0;
  let previousDependencies: readonly unknown[] | null = null;
  const pump = async () => {
    if (!mounted || !surface || !draw || running || failed) {
      return;
    }
    running = true;
    const current = surface;
    try {
      while (true) {
        if (!mounted || surface !== current || (!dirty && !continuous)) {
          break;
        }
        dirty = false;
        // oxlint-disable-next-line no-await-in-loop -- Complete each draw before transferring its frame.
        await draw(current.canvas);
        if (!mounted || surface !== current) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop -- Host acknowledgements pace the producer and bound the frame queue.
        await current.present();
      }
    } catch (error) {
      if (mounted && surface === current) {
        failed = true;
        notify({
          error: error instanceof Error ? error : new Error(String(error)),
          status: "error",
        });
      }
    } finally {
      running = false;
      if (mounted && dirty && !failed) {
        void pump();
      }
    }
  };
  const connect = async (generation: string | null) => {
    epoch += 1;
    const revision = epoch;
    surface?.close();
    surface = null;
    failed = false;
    notify({ error: null, status: "pending" });
    if (generation === null) {
      return;
    }
    try {
      const next = await experimental_requestCanvas(binding, generation);
      if (!mounted || epoch !== revision) {
        next.close();
        return;
      }
      surface = next;
      dirty = true;
      notify({ error: null, status: "ready" });
      void pump();
    } catch (error) {
      if (mounted && epoch === revision) {
        notify({
          error: error instanceof Error ? error : new Error(String(error)),
          status: "error",
        });
      }
    }
  };
  return {
    mount: () => {
      mounted = true;
      const watch = globalThis.__tailorkitWatchCanvas;
      if (!watch) {
        notify({
          error: new Error("Canvas lifecycle is unavailable."),
          status: "error",
        });
      }
      const unsubscribe = watch?.(binding, (generation) => {
        void connect(generation);
      });
      return () => {
        mounted = false;
        epoch += 1;
        unsubscribe?.();
        surface?.close();
        surface = null;
      };
    },
    update: (
      nextDraw: experimental_CanvasDraw,
      dependencies: readonly unknown[],
      nextContinuous: boolean
    ) => {
      const changed =
        previousDependencies === null ||
        previousDependencies.length !== dependencies.length ||
        dependencies.some(
          (value, index) => !Object.is(value, previousDependencies?.[index])
        );
      if (!changed && continuous === nextContinuous) {
        return;
      }
      previousDependencies = [...dependencies];
      draw = nextDraw;
      continuous = nextContinuous;
      dirty = true;
      failed = false;
      void pump();
    },
  };
};

/** Draw after host mounting, on dependency/size changes, or continuously with host pacing. */
const useCanvasSurface = (
  draw: experimental_CanvasDraw,
  dependencies: readonly unknown[],
  options: experimental_CanvasHookOptions = {}
) => {
  const id = useId();
  const binding = `canvas:${id}`;
  const [state, setState] = useState<experimental_CanvasHookState>({
    error: null,
    status: "pending",
  });
  const controller = useMemo(
    () => createController(binding, setState),
    [binding]
  );
  const continuous = options.continuous === true;
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => {
    controller.update(draw, dependencies, continuous);
  });
  return { ...state, binding };
};

export { useCanvasSurface as experimental_useCanvasSurface };
