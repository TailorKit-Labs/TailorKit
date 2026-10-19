import * as v from "valibot";

/** Runtime ABI. The host grants a port, never a DOM element or rendering context. */
export interface experimental_CanvasConnection {
  width: number;
  height: number;
  port: MessagePort;
  release: () => void;
}

declare global {
  var __tailorkitWatchCanvas:
    | ((
        name: string,
        listener: (generation: string | null) => void
      ) => () => void)
    | undefined;
  var __tailorkitRequestCanvas:
    | ((
        name: string,
        generation?: string
      ) => Promise<experimental_CanvasConnection>)
    | undefined;
}

export interface experimental_CanvasSurface {
  canvas: OffscreenCanvas;
  /** Transfers a complete frame and waits for host presentation. Redraw each frame. */
  present: () => Promise<void>;
  close: () => void;
}

const Reply = v.variant("type", [
  v.strictObject({ sequence: v.number(), type: v.literal("presented") }),
  v.strictObject({ message: v.string(), type: v.literal("closed") }),
]);

/** Request a surface explicitly registered by this app's host. */
export const experimental_requestCanvas = async (
  name: string,
  generation?: string
): Promise<experimental_CanvasSurface> => {
  const request = globalThis.__tailorkitRequestCanvas;
  if (!request || typeof OffscreenCanvas === "undefined") {
    throw new Error("Sandbox canvas rendering is unavailable.");
  }
  const { port, width, height, release } = await request(name, generation);
  const canvas = new OffscreenCanvas(width, height);
  let closed = false;
  let sequence = 0;
  let pending: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const close = (message = "Canvas surface closed.") => {
    if (closed) {
      return;
    }
    closed = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      pending = null;
    }
    port.postMessage({ type: "close" });
    port.close();
    release();
    canvas.width = 0;
    canvas.height = 0;
  };
  port.addEventListener("message", (event: MessageEvent<unknown>) => {
    const parsed = v.safeParse(Reply, event.data);
    if (!parsed.success) {
      close("Invalid canvas reply.");
      return;
    }
    if (parsed.output.type === "closed") {
      close(parsed.output.message);
      return;
    }
    if (pending && parsed.output.sequence === sequence) {
      clearTimeout(pending.timer);
      pending.resolve();
      pending = null;
    }
  });
  port.addEventListener("messageerror", () => {
    close("Canvas message could not be decoded.");
  });
  port.start();
  return {
    canvas,
    close,
    present: async () => {
      if (closed) {
        throw new Error("Canvas surface closed.");
      }
      if (pending) {
        throw new Error("Await the previous canvas presentation first.");
      }
      if (canvas.width !== width || canvas.height !== height) {
        throw new Error("Canvas dimensions must match the host surface.");
      }
      const bitmap = canvas.transferToImageBitmap();
      const { promise, resolve, reject } = Promise.withResolvers<boolean>();
      sequence += 1;
      const timer = setTimeout(() => {
        close("Canvas presentation timed out.");
      }, 30_000);
      pending = {
        reject,
        resolve: () => {
          resolve(true);
        },
        timer,
      };
      try {
        port.postMessage({ bitmap, sequence, type: "frame" }, [bitmap]);
      } catch (error) {
        bitmap.close();
        close(error instanceof Error ? error.message : String(error));
      }
      await promise;
    },
  };
};
