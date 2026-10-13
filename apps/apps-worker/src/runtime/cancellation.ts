export const abortable = <T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> =>
  (() => {
    const {
      promise: pendingPromise,
      resolve,
      reject,
    } = Promise.withResolvers<T>();
    try {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }

      const cleanup = () => signal.removeEventListener("abort", abort);
      (async () => {
        try {
          return await (async () => {
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
    return pendingPromise;
  })();

/** Streams can carry cancellation across Workers RPC without serializing an AbortSignal. */
// oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep the generator or mutable callback with its owning test or cancellation lifecycle.
const noopCleanup = () => {
  /* No reader is active before stream initialization. */
};
export const cancellationStream = (signal: AbortSignal) => {
  let cleanup = noopCleanup;

  return new ReadableStream<never>({
    cancel() {
      cleanup();
    },
    start(controller) {
      const abort = () => {
        cleanup();
        controller.close();
      };
      cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    },
  });
};
