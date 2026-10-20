/** Yield even when a frame is skipped; hidden sandbox iframes cannot rely on rAF. */
export const waitForCanvasFrame = async (
  milliseconds: number,
  signal: AbortSignal
) => {
  if (signal.aborted) {
    return;
  }
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(resolve, Math.max(0, Math.ceil(milliseconds)), true);
  const cancel = () => {
    clearTimeout(timer);
    resolve(true);
  };
  signal.addEventListener("abort", cancel, { once: true });
  await promise;
  signal.removeEventListener("abort", cancel);
};
