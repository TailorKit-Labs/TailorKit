import * as v from "valibot";
import source from "virtual:canvas-client";

import { createIframeUiHost } from "../src/host/index";
import { Result } from "./shared";
import type { BenchmarkConfiguration, BenchmarkResultData } from "./shared";

interface BenchmarkResult {
  name: string;
  result: BenchmarkResultData;
  snapshots: number;
}
declare global {
  var runCanvasChecks: (() => Promise<BenchmarkResult[]>) | undefined;
  var canvasResults: BenchmarkResult[] | undefined;
}

const status = document.querySelector("#status");
const output = document.querySelector("#results");
const button = document.querySelector("#run");
const display = document.querySelector("#display");
if (
  !status ||
  !output ||
  !(button instanceof HTMLButtonElement) ||
  !(display instanceof HTMLCanvasElement)
) {
  throw new Error("Missing benchmark elements.");
}

const runCase = async (
  mode: BenchmarkConfiguration["mode"],
  width = 320,
  height = 200,
  maxFramesPerSecond = 240
): Promise<BenchmarkResult> => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-label", "Sandbox graphics output");
  document.querySelector("canvas")?.replaceWith(canvas);
  const { promise, resolve, reject } =
    Promise.withResolvers<BenchmarkResultData>();
  let unregister: (() => void) | undefined;
  let snapshots = 0;
  const host = createIframeUiHost("https://benchmark.invalid/client.js", {
    fetch: async () => await Promise.resolve(new Response(source)),
    onError: reject,
    props: {
      context: { frames: 120, mode },
      controlled: true,
      declaredViews: ["/"],
      slot: "benchmark",
      status: "ready",
      supportedViews: ["/"],
      view: "/",
    },
    toolBridge: {
      client: async (path, input) => {
        if (path === "revoke") {
          unregister?.();
        } else if (path === "verify") {
          const { red } = v.parse(v.object({ red: v.number() }), input);
          const bitmap = await createImageBitmap(canvas);
          const reader = new OffscreenCanvas(width, height).getContext("2d");
          if (!reader) {
            throw new Error("Pixel readback context unavailable.");
          }
          reader.drawImage(bitmap, 0, 0);
          bitmap.close();
          const [r, g, b, a] = reader.getImageData(0, 0, 1, 1).data;
          if (r !== red || g !== 128 || b !== 0 || a !== 255) {
            throw new Error(`Incorrect host pixels: ${r},${g},${b},${a}`);
          }
        } else if (path === "result") {
          resolve(v.parse(Result, input));
        }
        await Promise.resolve();
      },
      session: () => {
        throw new Error("No backend session in canvas checks.");
      },
    },
  });
  const timer = setTimeout(() => {
    reject(new Error(`Case ${mode} timed out.`));
  }, 20_000);
  try {
    unregister = host.registerCanvas("display", canvas, { maxFramesPerSecond });
    host.subscribe(() => {
      snapshots += 1;
    });
    host.mount();
    const result = await promise;
    const { passed } = v.parse(Result, result);
    if (
      !passed ||
      snapshots > 2 ||
      (result.framesPerSecond !== undefined &&
        result.framesPerSecond > maxFramesPerSecond + 1)
    ) {
      throw new Error(
        `Canvas check failed: ${JSON.stringify({ mode, result, snapshots })}`
      );
    }
    return {
      name: `${mode} ${width}x${height} cap=${maxFramesPerSecond}`,
      result,
      snapshots,
    };
  } finally {
    clearTimeout(timer);
    host.destroy();
  }
};

const runChecks = async () => {
  button.disabled = true;
  const results: BenchmarkResult[] = [];
  try {
    const modes: BenchmarkConfiguration["mode"][] = [
      "unregistered",
      "concurrent",
      "wrong-size",
      "flood",
      "revoke",
    ];
    for (const mode of modes) {
      status.textContent = `Checking ${mode}…`;
      // oxlint-disable-next-line no-await-in-loop -- Cases share the visible canvas and must not compete for presentation time.
      results.push(await runCase(mode));
    }
    for (const [width, height, rate] of [
      [320, 200, 240],
      [1280, 720, 240],
      [1920, 1080, 240],
      [320, 200, 30],
    ]) {
      if (width === undefined || height === undefined || rate === undefined) {
        throw new Error("Invalid benchmark dimensions.");
      }
      status.textContent = `Measuring ${width} × ${height}…`;
      // oxlint-disable-next-line no-await-in-loop -- Sequential measurements avoid contention between cases.
      results.push(await runCase("frames", width, height, rate));
    }
    globalThis.canvasResults = results;
    output.textContent = JSON.stringify(
      { results, userAgent: navigator.userAgent },
      null,
      2
    );
    status.textContent = "All checks passed";
    return results;
  } catch (error) {
    status.textContent = String(error);
    throw error;
  } finally {
    button.disabled = false;
  }
};
globalThis.runCanvasChecks = runChecks;
button.addEventListener("click", () => {
  void (async () => {
    try {
      await runChecks();
    } catch (error) {
      console.error(error);
    }
  })();
});
