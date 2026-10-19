const nextFrame = async () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  requestAnimationFrame(resolve);
  return await promise;
};
const waitFor = async (
  check: () => boolean | Promise<boolean>,
  message: string
) => {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Poll browser presentation until the observable condition holds.
    if (await check()) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Yield to browser rendering between checks.
    await nextFrame();
  }
  throw new Error(message);
};
const region = (label: string): HTMLElement => {
  const element = document.querySelector(`section[aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing ${label}.`);
  }
  return element;
};
const click = (root: ParentNode, name: string) => {
  const button = [...root.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );
  if (!button) {
    throw new Error(`Missing button ${name}.`);
  }
  button.click();
};
const canvas = (label: string): HTMLCanvasElement => {
  const element = region(label).querySelector("canvas");
  if (!element) {
    throw new Error(`Missing canvas in ${label}.`);
  }
  return element;
};
const pixels = async (label: string) => {
  const element = canvas(label);
  const bitmap = await createImageBitmap(element);
  const reader = new OffscreenCanvas(element.width, element.height).getContext(
    "2d"
  );
  if (!reader) {
    throw new Error("Pixel readback unavailable.");
  }
  reader.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = reader.getImageData(0, 0, element.width, element.height);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return {
    hash: [...new Uint8Array(digest)].join(","),
    painted: data[3] === 255,
    width: element.width,
  };
};

const hash = async (label: string) => {
  const value = await pixels(label);
  return value.hash;
};
const painted = async (label: string) => {
  const value = await pixels(label);
  return value.painted;
};

/** Run from a freshly loaded standalone demo; throws on the first failed boundary. */
export const runCanvasChecks = async () => {
  await waitFor(
    async () =>
      region("First app").textContent?.includes("Canvas ready") &&
      (await painted("First app")),
    "Initial canvas did not paint."
  );
  const first = region("First app");
  const initial = await pixels("First app");
  click(first, "Redraw chart");
  await waitFor(
    async () => (await hash("First app")) !== initial.hash,
    "Dependency change did not redraw."
  );
  click(first, "Resize chart");
  await waitFor(async () => {
    const result = await pixels("First app");
    return result.width === 640 && result.painted;
  }, "Resize did not reconnect and repaint.");
  click(first, "Hide chart");
  await waitFor(
    () => first.querySelector("canvas") === null,
    "Unmount retained the canvas."
  );
  click(first, "Show chart");
  await waitFor(
    async () =>
      first.querySelector("canvas") !== null && (await painted("First app")),
    "Remount did not repaint."
  );
  const staticFrame = await pixels("First app");
  click(first, "Animate chart");
  await waitFor(
    async () => (await hash("First app")) !== staticFrame.hash,
    "Animation did not start."
  );
  click(first, "Stop animation");
  // Allow the last submitted frame and static redraw to settle, then verify stability.
  const settledAt = performance.now() + 150;
  await waitFor(
    () => performance.now() >= settledAt,
    "Animation did not settle."
  );
  const stopped = await pixels("First app");
  const checkedAt = performance.now() + 150;
  await waitFor(
    () => performance.now() >= checkedAt,
    "Static frame check timed out."
  );
  if ((await hash("First app")) !== stopped.hash) {
    throw new Error("Animation continued after stopping.");
  }
  click(document, "Mount second app");
  await waitFor(
    async () =>
      document.querySelectorAll("canvas").length === 2 &&
      (await painted("Second app")),
    "Second app did not paint."
  );
  const second = await pixels("Second app");
  click(region("Second app"), "Redraw chart");
  await waitFor(
    async () => (await hash("Second app")) !== second.hash,
    "Second app did not redraw."
  );
  if ((await hash("First app")) !== stopped.hash) {
    throw new Error("Second app changed the first app's output.");
  }
  const oldCanvas = canvas("First app");
  const [oldIframe] = document.querySelectorAll("iframe");
  click(document, "Restart sandbox");
  await waitFor(
    async () =>
      !oldCanvas.isConnected &&
      !oldIframe?.isConnected &&
      region("First app").querySelector("canvas") !== null &&
      (await painted("First app")),
    "Sandbox restart retained stale output or did not repaint."
  );
  click(document, "Remove second app");
  await waitFor(
    () => document.querySelectorAll("iframe").length === 1,
    "Second sandbox was not removed."
  );
  return {
    passed: true,
    checks: [
      "initial paint",
      "dependency redraw",
      "resize",
      "unmount",
      "remount",
      "animation start/stop",
      "app isolation",
      "sandbox restart",
      "sandbox cleanup",
    ],
  };
};

declare global {
  var experimental_runCanvasChecks: typeof runCanvasChecks | undefined;
}

globalThis.experimental_runCanvasChecks = runCanvasChecks;
