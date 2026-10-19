import type {
  experimental_requestCanvas,
  experimental_CanvasSurface,
} from "./canvas";

export type experimental_CanvasDraw = (
  canvas: OffscreenCanvas
) => void | Promise<void>;
export interface experimental_CanvasSetupContext {
  signal: AbortSignal;
  /** Schedule presentation after an external library draws or changes its state. */
  invalidate: () => void;
}
export interface experimental_CanvasLifecycle<T> {
  setup: (
    canvas: OffscreenCanvas,
    context: experimental_CanvasSetupContext
  ) => T | Promise<T>;
  draw: (resource: NoInfer<T>, canvas: OffscreenCanvas) => void | Promise<void>;
  dispose?: (resource: NoInfer<T>) => void;
}
export interface experimental_CanvasHookOptions {
  continuous?: boolean;
  /** Defaults to true so libraries can retain their drawing buffer. */
  preserveDrawingBuffer?: boolean;
}
export interface experimental_CanvasHookState {
  status: "pending" | "ready" | "error";
  error: Error | null;
}
interface Connection {
  surface: experimental_CanvasSurface;
  lifetime: AbortController;
  draw: experimental_CanvasDraw;
  dispose?: () => void;
  running: boolean;
  dirty: boolean;
  failed: boolean;
}
type Watch = (
  binding: string,
  listener: (generation: string | null) => void
) => () => void;

/** Dependencies are injectable so lifecycle races can be tested without module mocks. */
export const createCanvasController = <T>(
  binding: string,
  notify: (state: experimental_CanvasHookState) => void,
  dependencies: { request: typeof experimental_requestCanvas; watch: Watch }
) => {
  let definition:
    | experimental_CanvasDraw
    | experimental_CanvasLifecycle<T>
    | null = null;
  let current: Connection | null = null;
  let pendingLifetime: AbortController | null = null;
  let mounted = false;
  let continuous = false;
  let preserveDrawingBuffer = true;
  let generation: string | null = null;
  let epoch = 0;
  let recovered = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let previousDependencies: readonly unknown[] | null = null;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught JavaScript values and AbortSignal.reason are untyped error boundaries.
  const report = (error: unknown) => {
    notify({
      error: error instanceof Error ? error : new Error(String(error)),
      status: "error",
    });
  };
  const dispose = (cleanup: (() => void) | undefined) => {
    try {
      cleanup?.();
    } catch (error) {
      if (mounted) {
        report(error);
      }
    }
  };
  const retire = () => {
    pendingLifetime?.abort();
    pendingLifetime = null;
    const previous = current;
    current = null;
    if (previous) {
      previous.lifetime.abort();
      dispose(previous.dispose);
      previous.surface.close();
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  const pump = async (connection: Connection) => {
    if (
      !mounted ||
      current !== connection ||
      connection.running ||
      connection.failed
    ) {
      return;
    }
    connection.running = true;
    try {
      while (true) {
        if (
          !mounted ||
          current !== connection ||
          (!connection.dirty && !continuous)
        ) {
          break;
        }
        connection.dirty = false;
        // oxlint-disable-next-line no-await-in-loop -- Drawing must complete before a frame is snapshotted.
        await connection.draw(connection.surface.canvas);
        if (!mounted || current !== connection) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop -- Host acknowledgements bound the queue and pace continuous drawing.
        await connection.surface.present({ preserveDrawingBuffer });
      }
    } catch (error) {
      if (mounted && current === connection) {
        connection.failed = true;
        report(error);
      }
    } finally {
      connection.running = false;
      if (
        mounted &&
        current === connection &&
        connection.dirty &&
        !connection.failed
      ) {
        void pump(connection);
      }
    }
  };
  const invalidate = () => {
    if (current) {
      current.dirty = true;
      const connection = current;
      // Let all local input listeners finish before invoking the library's draw callback.
      queueMicrotask(() => {
        void pump(connection);
      });
    }
  };
  const connect = async () => {
    if (!mounted) {
      return;
    }
    epoch += 1;
    const revision = epoch;
    retire();
    notify({ error: null, status: "pending" });
    if (generation === null || definition === null) {
      return;
    }
    const lifetime = new AbortController();
    pendingLifetime = lifetime;
    let surface: experimental_CanvasSurface | null = null;
    try {
      surface = await dependencies.request(binding, generation);
      if (!mounted || epoch !== revision || lifetime.signal.aborted) {
        surface.close();
        return;
      }
      const granted = surface;
      const onClosed = () => {
        if (!mounted || epoch !== revision) {
          return;
        }
        const reason: unknown = granted.signal.reason;
        retire();
        report(reason);
        if (!recovered && generation !== null) {
          recovered = true;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void connect();
          }, 100);
        }
      };
      granted.signal.addEventListener("abort", onClosed, {
        once: true,
        signal: lifetime.signal,
      });
      const initialDefinition = definition;
      let draw: experimental_CanvasDraw;
      let cleanup: (() => void) | undefined;
      if ("setup" in initialDefinition) {
        const resource = await initialDefinition.setup(granted.canvas, {
          invalidate,
          signal: lifetime.signal,
        });
        cleanup = () => initialDefinition.dispose?.(resource);
        draw = async (canvas) => {
          if (definition !== null && "setup" in definition) {
            await definition.draw(resource, canvas);
          }
        };
      } else {
        draw = async (canvas) => {
          if (definition !== null && !("setup" in definition)) {
            await definition(canvas);
          }
        };
      }
      if (
        !mounted ||
        epoch !== revision ||
        lifetime.signal.aborted ||
        granted.signal.aborted
      ) {
        dispose(cleanup);
        granted.close();
        return;
      }
      const connection: Connection = {
        dirty: true,
        dispose: cleanup,
        draw,
        failed: false,
        lifetime,
        running: false,
        surface: granted,
      };
      current = connection;
      pendingLifetime = null;
      for (const type of [
        "pointermove",
        "pointerdown",
        "pointerup",
        "pointerleave",
        "click",
        "keydown",
        "keyup",
        "blur",
        "focus",
      ]) {
        granted.canvas.addEventListener(type, invalidate, {
          signal: lifetime.signal,
        });
      }
      notify({ error: null, status: "ready" });
      void pump(connection);
    } catch (error) {
      lifetime.abort();
      surface?.close();
      if (pendingLifetime === lifetime) {
        pendingLifetime = null;
      }
      if (mounted && epoch === revision) {
        report(error);
      }
    }
  };
  const retry = () => {
    recovered = false;
    void connect();
  };
  return {
    invalidate,
    mount: () => {
      mounted = true;
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = dependencies.watch(binding, (nextGeneration) => {
          if (generation !== nextGeneration) {
            generation = nextGeneration;
            recovered = false;
            void connect();
          }
        });
      } catch (error) {
        report(error);
      }
      return () => {
        mounted = false;
        generation = null;
        epoch += 1;
        unsubscribe?.();
        retire();
      };
    },
    retry,
    update: (
      next: experimental_CanvasDraw | experimental_CanvasLifecycle<T>,
      values: readonly unknown[],
      options: experimental_CanvasHookOptions
    ) => {
      const changed =
        previousDependencies === null ||
        previousDependencies.length !== values.length ||
        values.some(
          (value, index) => !Object.is(value, previousDependencies?.[index])
        );
      const wasLifecycle = definition !== null && "setup" in definition;
      const isLifecycle = "setup" in next;
      const modeChanged = definition !== null && wasLifecycle !== isLifecycle;
      const optionsChanged =
        continuous !== (options.continuous === true) ||
        preserveDrawingBuffer !== (options.preserveDrawingBuffer !== false);
      definition = next;
      continuous = options.continuous === true;
      preserveDrawingBuffer = options.preserveDrawingBuffer !== false;
      previousDependencies = [...values];
      if (
        modeChanged ||
        (changed &&
          current === null &&
          generation !== null &&
          pendingLifetime === null &&
          retryTimer === null)
      ) {
        void connect();
      } else if (changed || optionsChanged) {
        if (current) {
          current.failed = false;
          notify({ error: null, status: "ready" });
        }
        invalidate();
      }
    },
  };
};
