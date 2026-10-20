/** Yield even when a frame is skipped; hidden sandbox iframes cannot rely on rAF. */
export const waitForCanvasFrame = async (
  milliseconds: number,
  signal: AbortSignal
) => {
  if (signal.aborted) {
    return;
  }

  const { promise, resolve } = Promise.withResolvers<boolean>();
  // Browsers turn overflowing delays into short timers. Chunk long waits instead.
  const delay = Math.min(2_147_483_647, Math.max(0, Math.ceil(milliseconds)));
  const timer = setTimeout(resolve, delay, true);

  const cancel = () => {
    clearTimeout(timer);
    resolve(true);
  };

  signal.addEventListener("abort", cancel, { once: true });
  await promise;
  signal.removeEventListener("abort", cancel);
};
