import type {
  experimental_requestCanvas,
  experimental_CanvasSurface,
} from "./canvas";
import { waitForCanvasFrame } from "./canvas-scheduler";

export interface experimental_CanvasFrame {
  /** Monotonic milliseconds from the sandbox performance clock. */
  timestamp: number;
  /** Milliseconds since this connection's previous draw callback; zero initially. */
  deltaTime: number;
}

export type experimental_CanvasDraw = (
  canvas: OffscreenCanvas,
  frame: experimental_CanvasFrame
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Existing draw callbacks may omit a return; false explicitly skips presentation.
) => boolean | void | Promise<boolean | void>;
export interface experimental_CanvasCreateContext {
  signal: AbortSignal;
  /** Schedule presentation after an external library draws or changes its state. */
  invalidate: () => void;
}
export interface experimental_CanvasLifecycle<T> {
  /** Runs once per granted surface or change to createDependencies. */
  create: (
    canvas: OffscreenCanvas,
    context: experimental_CanvasCreateContext
  ) => T | Promise<T>;
  /** Runs initially and when the hook's update dependencies change. */
  update?: (
    resource: NoInfer<T>,
    canvas: OffscreenCanvas
  ) => void | Promise<void>;
  /** Runs before the first update of each newly granted surface. */
  resize?: (
    resource: NoInfer<T>,
    size: { width: number; height: number }
  ) => void | Promise<void>;
  /** Runs on each presentation, including input, invalidate(), and continuous frames. */
  draw?: (
    resource: NoInfer<T>,
    canvas: OffscreenCanvas,
    frame: experimental_CanvasFrame
    // oxlint-disable-next-line typescript/no-invalid-void-type -- Preserve void-returning library callbacks alongside the explicit skip result.
  ) => boolean | void | Promise<boolean | void>;
  dispose?: (resource: NoInfer<T>) => void;
}
export interface experimental_CanvasHookOptions {
  /** Recreate the resource when these values change; defaults to []. */
  createDependencies?: readonly unknown[];
  continuous?: boolean;
  /** App-side scheduling cap, 0 < FPS <= 240. The host independently enforces its cap. */
  framesPerSecond?: number;
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
  update?: (canvas: OffscreenCanvas) => void | Promise<void>;
  lastDraw: number | null;
  dispose?: () => void;
  running: boolean;
  dirty: boolean;
  updateDirty: boolean;
  failed: boolean;
}
type Watch = (
  binding: string,
  listener: (generation: string | null) => void
) => () => void;

const dependenciesChanged = (
  previous: readonly unknown[] | null,
  next: readonly unknown[]
) =>
  previous === null ||
  previous.length !== next.length ||
  next.some((value, index) => !Object.is(value, previous[index]));

const validateFramesPerSecond = (value: number | undefined) => {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value <= 0 || value > 240)
  ) {
    throw new RangeError(
      "Canvas framesPerSecond must be finite, greater than zero, and at most 240."
    );
  }
  return value;
};

/** Dependencies are injectable so lifecycle races can be tested without module mocks. */
export const createCanvasController = <T>(
  binding: string,
  notify: (state: experimental_CanvasHookState) => void,
  dependencies: {
    request: typeof experimental_requestCanvas;
    watch: Watch;
    now?: () => number;
  }
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
  let framesPerSecond: number | undefined;
  const now = dependencies.now ?? (() => performance.now());
  let generation: string | null = null;
  let epoch = 0;
  let recovered = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let previousDependencies: readonly unknown[] | null = null;
  let previousCreateDependencies: readonly unknown[] | null = null;
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
  const isCurrent = (connection: Connection) =>
    mounted && current === connection;
  const isActive = (revision: number, lifetime: AbortController) =>
    mounted && epoch === revision && !lifetime.signal.aborted;
  const drawFrame = async (connection: Connection) => {
    const timestamp = now();
    const frame = {
      deltaTime:
        connection.lastDraw === null ? 0 : timestamp - connection.lastDraw,
      timestamp,
    };
    connection.lastDraw = timestamp;
    const result = await connection.draw(connection.surface.canvas, frame);
    if (!isCurrent(connection)) {
      return;
    }
    if (result === false) {
      if (continuous || connection.dirty) {
        await waitForCanvasFrame(
          1000 / (framesPerSecond ?? 60) - (now() - timestamp),
          connection.lifetime.signal
        );
      }
      return;
    }
    await connection.surface.present({ preserveDrawingBuffer });
  };
  const pace = async (connection: Connection) => {
    if (framesPerSecond === undefined || connection.lastDraw === null) {
      return;
    }
    const delay = 1000 / framesPerSecond - (now() - connection.lastDraw);
    if (delay > 0) {
      await waitForCanvasFrame(delay, connection.lifetime.signal);
    }
  };
  const pump = async (connection: Connection) => {
    if (!isCurrent(connection) || connection.running || connection.failed) {
      return;
    }
    connection.running = true;
    try {
      while (true) {
        if (!isCurrent(connection) || (!connection.dirty && !continuous)) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop -- App pacing supplements the host's presentation cap.
        await pace(connection);
        if (!isCurrent(connection)) {
          break;
        }
        connection.dirty = false;
        if (connection.updateDirty) {
          connection.updateDirty = false;
          // oxlint-disable-next-line no-await-in-loop -- Serialize library updates before drawing and presentation.
          await connection.update?.(connection.surface.canvas);
          if (!isCurrent(connection)) {
            break;
          }
          if (connection.updateDirty) {
            continue;
          }
        }
        // oxlint-disable-next-line no-await-in-loop -- Drawing and presentation are serialized; skipped frames yield without snapshotting.
        await drawFrame(connection);
      }
    } catch (error) {
      if (isCurrent(connection)) {
        connection.failed = true;
        report(error);
      }
    } finally {
      connection.running = false;
      if (isCurrent(connection) && connection.dirty && !connection.failed) {
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
    let cleanup: (() => void) | undefined;
    try {
      surface = await dependencies.request(binding, generation);
      if (!isActive(revision, lifetime)) {
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
      let update: Connection["update"];
      if ("create" in initialDefinition) {
        const resource = await initialDefinition.create(granted.canvas, {
          invalidate: () => {
            if (isActive(revision, lifetime)) {
              invalidate();
            }
          },
          signal: lifetime.signal,
        });
        cleanup = () => initialDefinition.dispose?.(resource);
        if (isActive(revision, lifetime)) {
          await initialDefinition.resize?.(resource, {
            height: granted.canvas.height,
            width: granted.canvas.width,
          });
        }
        update = async (canvas) => {
          if (definition !== null && "create" in definition) {
            await definition.update?.(resource, canvas);
          }
        };
        draw = async (canvas, frame) => {
          if (definition !== null && "create" in definition) {
            return await definition.draw?.(resource, canvas, frame);
          }
        };
      } else {
        draw = async (canvas, frame) => {
          if (definition !== null && !("create" in definition)) {
            return await definition(canvas, frame);
          }
        };
      }
      if (!isActive(revision, lifetime) || granted.signal.aborted) {
        dispose(cleanup);
        granted.close();
        return;
      }
      const connection: Connection = {
        dirty: true,
        dispose: cleanup,
        draw,
        failed: false,
        lastDraw: null,
        lifetime,
        running: false,
        surface: granted,
        update,
        updateDirty: true,
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
      dispose(cleanup);
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
      const nextFramesPerSecond = validateFramesPerSecond(
        options.framesPerSecond
      );
      const changed = dependenciesChanged(previousDependencies, values);
      const createValues = options.createDependencies ?? [];
      const createChanged = dependenciesChanged(
        previousCreateDependencies,
        createValues
      );
      const wasLifecycle = definition !== null && "create" in definition;
      const isLifecycle = "create" in next;
      const modeChanged = definition !== null && wasLifecycle !== isLifecycle;
      const optionsChanged =
        framesPerSecond !== options.framesPerSecond ||
        continuous !== (options.continuous === true) ||
        preserveDrawingBuffer !== (options.preserveDrawingBuffer !== false);
      definition = next;
      framesPerSecond = nextFramesPerSecond;
      continuous = options.continuous === true;
      preserveDrawingBuffer = options.preserveDrawingBuffer !== false;
      previousDependencies = [...values];
      previousCreateDependencies = [...createValues];
      if (
        modeChanged ||
        (isLifecycle && createChanged) ||
        (changed &&
          current === null &&
          generation !== null &&
          pendingLifetime === null &&
          retryTimer === null)
      ) {
        void connect();
      } else if (changed || optionsChanged) {
        if (current) {
          current.updateDirty ||= changed;
          current.failed = false;
          notify({ error: null, status: "ready" });
        }
        invalidate();
      }
    },
  };
};
