export const abortable = async <T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> =>
  await (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject,
    } = Promise.withResolvers<T>();
    try {
      const abort = () => {
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }

      const cleanup = () => {
        signal.removeEventListener("abort", abort);
      };
      void (async () => {
        try {
          await (async () => {
            const value = await promise;
            cleanup();
            resolve(value);
          })();
        } catch (error) {
          cleanup();
          reject(error);
        }
      })();
    } catch (error) {
      reject(error);
    }
    return await pendingPromise;
  })();

/** Streams can carry cancellation across Workers RPC without serializing an AbortSignal. */

const noopCleanup = () => {
  /* No reader is active before stream initialization. */
};
export const cancellationStream = (signal: AbortSignal) => {
  let cleanup = noopCleanup;

  return new ReadableStream<never>({
    cancel: () => {
      cleanup();
    },
    start: (controller) => {
      const abort = () => {
        cleanup();
        controller.close();
      };
      cleanup = () => {
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    },
  });
};
