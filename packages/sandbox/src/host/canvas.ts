import { experimental_canvas } from "@patchsmith/core/schema";
import type { experimental_CanvasInputPolicy } from "@patchsmith/core/schema";
import * as v from "valibot";

import { createCanvasInput } from "./canvas-input";

const InputAck = v.strictObject({
  sequence: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(Number.MAX_SAFE_INTEGER)
  ),
  type: v.literal("inputAck"),
});

const Frame = v.strictObject({
  bitmap: v.custom<ImageBitmap>(
    (value) =>
      typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap
  ),
  sequence: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(Number.MAX_SAFE_INTEGER)
  ),
  type: v.literal("frame"),
});

const Close = v.strictObject({ type: v.literal("close") });

const Wait = v.strictObject({
  delay: v.pipe(v.number(), v.minValue(0), v.maxValue(2_147_483_647)),
  sequence: InputAck.entries.sequence,
  type: v.literal("wait"),
});

const CancelWait = v.strictObject({
  sequence: InputAck.entries.sequence,
  type: v.literal("cancelWait"),
});

export interface experimental_CanvasTargetOptions {
  /** Presentation is also gated by the browser's animation frames. Default: 60. */
  maxFramesPerSecond?: number;
  maxPixels?: number;
  input?: experimental_CanvasInputPolicy;
}

/** Keeps the visible canvas and presentation scheduling under host control. */
export const createCanvasTarget = (
  canvas: HTMLCanvasElement,
  options: experimental_CanvasTargetOptions = {}
) => {
  const { width, height } = canvas;
  const maxPixels = options.maxPixels ?? 4_194_304;
  const maxFramesPerSecond = options.maxFramesPerSecond ?? 60;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > maxPixels ||
    !Number.isInteger(maxPixels) ||
    maxPixels < 1 ||
    maxPixels > 4_194_304 ||
    !Number.isFinite(maxFramesPerSecond) ||
    maxFramesPerSecond < 1 ||
    maxFramesPerSecond > 240
  ) {
    throw new Error("Invalid canvas dimensions or presentation rate.");
  }

  const inputPolicy =
    experimental_canvas(options).experimental_canvas.input ?? {};

  const context = canvas.getContext("bitmaprenderer");

  if (!context) {
    throw new Error(
      "Canvas bitmap rendering is unavailable; use a fresh canvas."
    );
  }

  let connection: { close: (message: string) => void } | null = null;
  let disposed = false;
  let lastPresentation = -Infinity;

  return {
    close: () => {
      disposed = true;
      connection?.close("Host revoked the canvas surface.");
    },
    connect: (enableInput = false) => {
      if (disposed || connection) {
        throw new Error("Canvas surface is already connected or revoked.");
      }

      const { port1, port2 } = new MessageChannel();
      let pending: v.InferOutput<typeof Frame> | null = null;
      let animationFrame: number | null = null;
      let presentationTimer: ReturnType<typeof setTimeout> | null = null;
      let sequence = 0;
      let waitSequence = 0;
      let lastWake = -Infinity;
      let waitTimer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;
      let input: ReturnType<typeof createCanvasInput> | null = null;
      const visibilityLifetime = new AbortController();

      const cancelPresentation = () => {
        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }

        if (presentationTimer !== null) {
          clearTimeout(presentationTimer);
          presentationTimer = null;
        }
      };

      const close = (message: string) => {
        if (closed) {
          return;
        }

        closed = true;
        input?.close();

        cancelPresentation();

        if (waitTimer !== null) {
          clearTimeout(waitTimer);
          waitTimer = null;
        }

        visibilityLifetime.abort();

        pending?.bitmap.close();
        pending = null;
        port1.postMessage({ message, type: "closed" });
        port1.close();
        connection = null;
        context.transferFromImageBitmap(null);
      };

      input = createCanvasInput(
        canvas,
        port1,
        enableInput ? inputPolicy : {},
        () => {
          close("Invalid canvas input acknowledgement.");
        }
      );

      const schedulePresentation = (present: (timestamp: number) => void) => {
        if (document.hidden) {
          const delay = Math.max(
            0,
            1000 / maxFramesPerSecond - (performance.now() - lastPresentation)
          );

          presentationTimer = setTimeout(() => {
            present(performance.now());
          }, Math.ceil(delay));
        } else {
          animationFrame = requestAnimationFrame(present);
        }
      };

      const present = (timestamp: number) => {
        animationFrame = null;
        presentationTimer = null;

        if (closed || !pending) {
          return;
        }

        if (timestamp - lastPresentation + 0.5 < 1000 / maxFramesPerSecond) {
          schedulePresentation(present);

          return;
        }

        const frame = pending;
        pending = null;

        try {
          if (canvas.width !== width || canvas.height !== height) {
            throw new Error("Host canvas was resized; register a new surface.");
          }

          context.transferFromImageBitmap(frame.bitmap);
          lastPresentation = timestamp;
          port1.postMessage({ sequence: frame.sequence, type: "presented" });
        } catch {
          frame.bitmap.close();
          close("Canvas presentation failed.");
        }
      };

      document.addEventListener(
        "visibilitychange",
        () => {
          cancelPresentation();

          if (!closed && pending) {
            schedulePresentation(present);
          }
        },
        { signal: visibilityLifetime.signal }
      );

      port1.addEventListener("message", (event: MessageEvent<unknown>) => {
        const ack = v.safeParse(InputAck, event.data);

        if (ack.success) {
          input?.acknowledge(ack.output.sequence);

          return;
        }

        if (v.safeParse(Close, event.data).success) {
          close("Canvas surface closed.");

          return;
        }

        const wait = v.safeParse(Wait, event.data);

        if (wait.success) {
          if (
            closed ||
            waitTimer !== null ||
            wait.output.sequence !== waitSequence + 1
          ) {
            close("Canvas pacing violates surface limits or backpressure.");

            return;
          }

          waitSequence = wait.output.sequence;

          // Host timers are not subject to the hidden cross-origin iframe's
          // one-second wake-up alignment. Bound even bitmap-free draws by policy.
          const delay = Math.max(
            wait.output.delay,
            1000 / maxFramesPerSecond - (performance.now() - lastWake)
          );

          waitTimer = setTimeout(() => {
            waitTimer = null;
            lastWake = performance.now();
            port1.postMessage({ sequence: waitSequence, type: "ready" });
          }, Math.ceil(delay));

          return;
        }

        const cancelWait = v.safeParse(CancelWait, event.data);

        if (cancelWait.success) {
          if (cancelWait.output.sequence > waitSequence) {
            close("Invalid canvas pacing cancellation.");
          } else if (
            cancelWait.output.sequence === waitSequence &&
            waitTimer !== null
          ) {
            clearTimeout(waitTimer);
            waitTimer = null;
          }

          return;
        }

        const parsed = v.safeParse(Frame, event.data);

        if (!parsed.success) {
          // Release a transferred bitmap even when the surrounding envelope is malformed.
          const resource = v.safeParse(
            v.object({ bitmap: Frame.entries.bitmap }),
            event.data
          );

          if (resource.success) {
            resource.output.bitmap.close();
          }

          close("Invalid canvas frame.");

          return;
        }

        const frame = parsed.output;

        if (
          closed ||
          pending ||
          frame.sequence !== sequence + 1 ||
          frame.bitmap.width !== width ||
          frame.bitmap.height !== height
        ) {
          frame.bitmap.close();
          close("Canvas frame violates surface limits or backpressure.");

          return;
        }

        ({ sequence } = frame);
        pending = frame;
        schedulePresentation(present);
      });
      port1.addEventListener("messageerror", () => {
        close("Canvas message could not be decoded.");
      });
      port1.start();
      connection = { close };

      return { height, port: port2, width };
    },
  };
};
