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
  let barPixels = 0;
  let labelPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    if (red === 101 && green === 181 && blue === 255) {
      barPixels += 1;
    }
    if (red > 150 && green > 150 && blue > 150) {
      labelPixels += 1;
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return {
    barPixels,
    hash: [...new Uint8Array(digest)].join(","),
    labelPixels,
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
  if (
    !first.textContent?.includes("Chart.js 4.5.1") ||
    initial.barPixels < 100 ||
    initial.labelPixels < 20
  ) {
    throw new Error("Chart.js did not render both bars and axis labels.");
  }
  click(first, "Redraw chart");
  await waitFor(
    async () => (await hash("First app")) !== initial.hash,
    "Dependency change did not redraw."
  );
  click(first, "Resize chart");
  await waitFor(async () => {
    const result = await pixels("First app");
    return (
      result.width === 640 &&
      result.painted &&
      first.textContent?.includes("Active Chart.js instances: 1")
    );
  }, "Resize did not reconnect and repaint.");
  click(first, "Hide chart");
  await waitFor(
    () =>
      first.querySelector("canvas") === null &&
      first.textContent?.includes("Active Chart.js instances: 0"),
    "Unmount retained the canvas or Chart.js instance."
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
  await waitFor(
    () =>
      [...first.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Animate chart"
      ),
    "Stop action did not reach the sandbox."
  );
  // The remote button update can precede the sandbox effect and final frame.
  // Wait for the known static chart rather than assuming a fixed settling time.
  await waitFor(
    async () => (await hash("First app")) === staticFrame.hash,
    "Stopping animation did not restore the static chart."
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
      "Chart.js bars and axis labels",
      "dependency redraw",
      "resize",
      "unmount and Chart.js instance cleanup",
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
