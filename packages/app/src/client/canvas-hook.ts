import { useEffect, useId, useMemo, useState } from "preact/hooks";

import { experimental_requestCanvas } from "./canvas";
import { createCanvasController } from "./canvas-controller";
import type {
  experimental_CanvasDraw,
  experimental_CanvasLifecycle,
  experimental_CanvasHookOptions,
  experimental_CanvasHookState,
} from "./canvas-controller";

export type {
  experimental_CanvasDraw,
  experimental_CanvasFrame,
  experimental_CanvasLifecycle,
  experimental_CanvasCreateContext,
  experimental_CanvasHookOptions,
  experimental_CanvasHookState,
} from "./canvas-controller";

export interface experimental_CanvasHookResult extends experimental_CanvasHookState {
  binding: string;
  invalidate: () => void;
  retry: () => void;
}

interface UseCanvasSurface {
  <T>(
    definition: experimental_CanvasLifecycle<T>,
    updateDependencies: readonly unknown[],
    options?: experimental_CanvasHookOptions
  ): experimental_CanvasHookResult;
  (
    definition: experimental_CanvasDraw,
    dependencies: readonly unknown[],
    options?: experimental_CanvasHookOptions
  ): experimental_CanvasHookResult;
}

/**
 * Connect drawing or a library lifecycle to a host-owned surface.
 * Lifecycle dependencies trigger update; options.createDependencies recreate the resource.
 */
const useCanvasSurface: UseCanvasSurface = <T>(
  definition: experimental_CanvasDraw | experimental_CanvasLifecycle<T>,
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
    () =>
      createCanvasController<T>(binding, setState, {
        request: experimental_requestCanvas,
        watch: (name, listener) => {
          const watch = globalThis.__patchsmithWatchCanvas;

          if (!watch) {
            throw new Error("Canvas lifecycle is unavailable.");
          }

          return watch(name, listener);
        },
      }),
    [binding]
  );

  // Effects run in declaration order: install the current definition before watching availability.
  useEffect(() => {
    controller.update(definition, dependencies, options);
  });
  useEffect(() => controller.mount(), [controller]);
  useEffect(() => {
    const resume = () => {
      if (!document.hidden && state.status === "error") {
        controller.retry();
      }
    };

    document.addEventListener("visibilitychange", resume);

    return () => {
      document.removeEventListener("visibilitychange", resume);
    };
  }, [controller, state.status]);

  return {
    ...state,
    binding,
    invalidate: controller.invalidate,
    retry: controller.retry,
  };
};

export { useCanvasSurface as experimental_useCanvasSurface };
