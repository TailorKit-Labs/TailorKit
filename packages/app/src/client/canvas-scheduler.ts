export type CanvasWaitRequest =
  | { type: "wait"; sequence: number; delay: number }
  | { type: "cancelWait"; sequence: number };

/** Delayed work must run in the host: Chromium throttles hidden iframe timers. */
export const createCanvasFrameScheduler = (
  send: (request: CanvasWaitRequest) => void
) => {
  let sequence = 0;
  let closed: Error | null = null;

  let pending: {
    sequence: number;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  return {
    close: (error: Error) => {
      closed = error;
      pending?.reject(error);
      pending = null;
    },
    receive: (reply: number) => {
      if (pending?.sequence === reply) {
        const previous = pending;
        pending = null;
        previous.resolve();
      }
    },
    wait: async (milliseconds: number, signal: AbortSignal) => {
      if (closed) {
        throw closed;
      }

      if (signal.aborted) {
        return;
      }

      if (Number.isNaN(milliseconds)) {
        throw new RangeError("Canvas pacing delay must be a number.");
      }

      if (pending) {
        throw new Error("Await the previous canvas pacing request first.");
      }

      const { promise, resolve, reject } = Promise.withResolvers<boolean>();
      sequence += 1;

      const current = {
        reject,
        resolve: () => {
          resolve(true);
        },
        sequence,
      };

      pending = current;

      const cancel = () => {
        if (pending === current) {
          pending = null;
          send({ sequence: current.sequence, type: "cancelWait" });
          resolve(true);
        }
      };

      signal.addEventListener("abort", cancel, { once: true });

      try {
        // Chunk extremely low frame rates instead of overflowing browser timers.
        const delay = Math.min(
          2_147_483_647,
          Math.max(0, Math.ceil(milliseconds))
        );

        send({ delay, sequence: current.sequence, type: "wait" });
        await promise;
      } finally {
        signal.removeEventListener("abort", cancel);

        if (pending === current) {
          pending = null;
        }
      }
    },
  };
};
