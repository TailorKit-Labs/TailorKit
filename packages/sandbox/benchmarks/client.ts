import {
  callTool,
  createFileClient,
  experimental_requestCanvas,
} from "@tailorkit/app/client";
import type { experimental_CanvasSurface } from "@tailorkit/app/client";
import * as v from "valibot";

import { Configuration } from "./shared";

const checkLegacyInput = async () => {
  const request = globalThis.__tailorkitRequestCanvas;
  if (!request) {
    throw new Error("Canvas ABI unavailable.");
  }
  const { port, release } = await request("display");
  try {
    await callTool("client", "verifyInput", { focusable: false });
    return { passed: true };
  } finally {
    port.postMessage({ type: "close" });
    port.close();
    release();
  }
};

const checkPreservedBuffer = async (
  surface: experimental_CanvasSurface,
  context: OffscreenCanvasRenderingContext2D
) => {
  context.fillStyle = "rgb(42, 128, 0)";
  context.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
  await surface.present({ preserveDrawingBuffer: true });
  if (context.getImageData(0, 0, 1, 1).data[0] !== 42) {
    throw new Error("Snapshot presentation cleared the source canvas.");
  }
  await surface.present({ preserveDrawingBuffer: true });
  await callTool("client", "verify", { red: 42 });
  await surface.present();
  if (context.getImageData(0, 0, 1, 1).data[3] !== 0) {
    throw new Error("Transfer presentation failed to clear the source canvas.");
  }
  return { passed: true };
};

const checkEvaluation = async () => {
  // oxlint-disable-next-line no-eval -- Deliberately verify string evaluation inside the production opaque-origin iframe, never in the host.
  const value: unknown = globalThis.eval("6 * 7");
  v.parse(v.literal(42), value);
  const module = await WebAssembly.compile(
    new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  );
  await WebAssembly.instantiate(module);
  let isolated = false;
  try {
    // Reading parent DOM must still fail after string evaluation and Wasm compilation.
    isolated = window.parent.document === document;
  } catch {
    return { passed: true };
  }
  throw new Error(
    `Sandbox parent access was unexpectedly available: ${isolated}`
  );
};

const run = async (configuration: v.InferOutput<typeof Configuration>) => {
  if (configuration.mode === "evaluation") {
    return await checkEvaluation();
  }
  if (configuration.mode === "unregistered") {
    try {
      await experimental_requestCanvas("not-granted");
    } catch {
      return { passed: true };
    }
    throw new Error("Unregistered surface was granted.");
  }
  if (configuration.mode === "wrong-size" || configuration.mode === "flood") {
    const request = globalThis.__tailorkitRequestCanvas;
    if (!request) {
      throw new Error("Canvas ABI unavailable.");
    }
    const { port, width, height, release } = await request("display");
    const { promise, resolve, reject } = Promise.withResolvers<{
      passed: boolean;
    }>();
    const timer = setTimeout(() => {
      reject(new Error("Invalid producer was not disconnected."));
    }, 5000);
    port.addEventListener("message", (event: MessageEvent<unknown>) => {
      const reply = v.safeParse(
        v.object({ type: v.literal("closed") }),
        event.data
      );
      if (reply.success) {
        clearTimeout(timer);
        port.close();
        release();
        resolve({ passed: true });
      }
    });
    port.start();
    const source = new OffscreenCanvas(
      configuration.mode === "wrong-size" ? width + 1 : width,
      height
    );
    source.getContext("2d");
    const count = configuration.mode === "flood" ? 8 : 1;
    for (let sequence = 1; sequence <= count; sequence += 1) {
      const bitmap = source.transferToImageBitmap();
      port.postMessage({ bitmap, sequence, type: "frame" }, [bitmap]);
    }
    return await promise;
  }
  if (configuration.mode === "legacy-input") {
    return await checkLegacyInput();
  }
  const surface = await experimental_requestCanvas("display");
  const context = surface.canvas.getContext("2d");
  if (!context) {
    throw new Error("Offscreen 2D context unavailable.");
  }
  try {
    if (configuration.mode === "native-input") {
      await callTool("client", "verifyInput", { focusable: true });
      return { passed: true };
    }
    if (configuration.mode === "revoke") {
      await callTool("client", "revoke");
      try {
        await surface.present();
      } catch {
        return { passed: true };
      }
      throw new Error("Revoked surface accepted a frame.");
    }
    if (configuration.mode === "preserve-buffer") {
      return await checkPreservedBuffer(surface, context);
    }
    if (configuration.mode === "concurrent") {
      const first = surface.present();
      let rejected = false;
      try {
        await surface.present();
      } catch {
        rejected = true;
      }
      await first;
      if (!rejected) {
        throw new Error("Concurrent presentation was accepted.");
      }
      return { passed: true };
    }
    const { width, height } = surface.canvas;
    const image = context.createImageData(width, height);
    const pixels = new Uint32Array(image.data.buffer);
    const latencies: number[] = [];
    // Warm the graphics pipeline before measuring the complete producer -> host -> ACK loop.
    context.putImageData(image, 0, 0);
    await surface.present();
    const started = performance.now();
    for (let frame = 0; frame < configuration.frames; frame += 1) {
      const start = performance.now();
      pixels.fill(0xff_00_80_00 + ((frame * 17) % 256));
      context.putImageData(image, 0, 0);
      // oxlint-disable-next-line no-await-in-loop -- Each frame waits for host acknowledgement to measure bounded streaming.
      await surface.present();
      latencies.push(performance.now() - start);
    }
    const elapsedMs = performance.now() - started;
    await callTool("client", "verify", {
      red: ((configuration.frames - 1) * 17) % 256,
    });
    latencies.sort((a, b) => a - b);
    return {
      elapsedMs,
      equivalentMegabytesPerSecond:
        (width * height * 4 * configuration.frames) / elapsedMs / 1000,
      frames: configuration.frames,
      framesPerSecond: (configuration.frames * 1000) / elapsedMs,
      height,
      p95FrameMs: latencies[Math.floor(latencies.length * 0.95)],
      passed: true,
      width,
    };
  } finally {
    surface.close();
  }
};

let started = false;
export default createFileClient({
  layouts: [],
  roots: [],
  views: [
    {
      definition: {
        component: ({ context }: { context?: unknown }) => {
          if (!started) {
            started = true;
            void (async () => {
              try {
                const result = await run(v.parse(Configuration, context));
                await callTool("client", "result", result);
              } catch (error) {
                await callTool("client", "result", {
                  error: String(error),
                  passed: false,
                });
              }
            })();
          }
          return null;
        },
        path: "/",
        slot: "benchmark",
      },
      filename: "slots/benchmark/index.ts",
      path: "/",
      slot: "benchmark",
    },
  ],
});
