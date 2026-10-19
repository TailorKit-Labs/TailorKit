# TailorKit sandbox

`@tailorkit/sandbox` runs TailorKit extensions in an opaque-origin iframe. Apps describe UI; the host owns the rendered DOM and sensitive capabilities.

## Experimental canvas surfaces

The low-level `createIframeUiHost` API can grant named pixel surfaces. The sandbox draws into its own `OffscreenCanvas`, transfers completed `ImageBitmap` frames through a dedicated `MessagePort`, and waits for the host to present each frame. Frames bypass component serialization and React reconciliation. This is an explicit frame-transfer design; it does not transfer control of the visible host canvas to untrusted code.

The host registers an unused canvas before the app requests it:

```ts
const revoke = host.registerCanvas("visualization", canvasElement, {
  maxFramesPerSecond: 60,
});

// Revoke access, discard any pending frame, and clear the visible surface.
revoke();
```

The canvas must support `getContext("bitmaprenderer")` and must not already have a different context. The host controls its CSS size, accessible description, focus, and placement. Its backing dimensions are fixed for a registration; revoke and register again to change them.

Inside the app:

```ts
import { requestCanvas } from "tailorkit/client";

const surface = await requestCanvas("visualization");
try {
  const context = surface.canvas.getContext("2d");
  if (!context) {
    throw new Error("2D rendering is unavailable");
  }
  context.fillStyle = "royalblue";
  context.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
  await surface.present();
  // Draw and present further complete frames here.
} finally {
  surface.close();
}
```

`transferToImageBitmap()` replaces the source image with a blank image: redraw the complete frame before each `present()`. Await presentation before sending another frame. The acknowledgement means that the host consumed the bitmap during an animation-frame callback, rather than proof that pixels have reached the physical display. Keep a surface open for as long as its output should remain visible; closing it clears the host canvas.

This first API is available on the low-level sandbox host. `RenderSlot` does not automatically expose a canvas component. Framework adapters and host contracts can build on the registration API in a follow-up. Keyboard/pointer input, audio, WebAssembly policy changes, and dedicated workers are separate capabilities; this change adds none of them.

## Limits and lifecycle

- A host can register eight surfaces per sandbox, each at most 4096 pixels per axis and 4,194,304 total pixels. Names must contain 1–128 characters. Duplicate names or elements within a sandbox are rejected.
- Each registration accepts one connection at a time and one pending frame. Frame dimensions and increasing sequence numbers are checked on the host. Oversized, malformed, or overlapping frames close the connection and release received bitmaps.
- Host presentation is gated by `requestAnimationFrame` and `maxFramesPerSecond` (default 60, accepted range 1–240). Background tabs may pause presentation. Registration rate limits persist across reconnections.
- The SDK rejects overlapping `present()` calls and changed source dimensions. Requests and presentations time out after 30 seconds. Hosts can revoke at any time; destroying the host closes every surface and removes the iframe.
- Apps receive pixel output capability only. They do not receive the host canvas, rendering context, DOM references, credentials, or an arbitrary host API. The existing iframe sandbox flags and CSP remain in place.

These limits bound accepted output and retained application queues, not all browser resources. An untrusted app can still consume CPU/GPU/memory or enqueue transport messages before disconnection; large bitmaps exist before the host can inspect them. An iframe is not a hard resource quota. Pixel content also needs an accessibility alternative supplied by the app/host, and may imitate UI within its allocated rectangle.

## Browser checks and throughput

Build the sandbox's dependencies from the repository root, then start the harness:

```sh
pnpm exec turbo run build --filter=@tailorkit/sandbox
pnpm --filter @tailorkit/sandbox bench:canvas
```

Open http://127.0.0.1:5190 and click **Run checks and throughput measurements**. Keep the tab visible. Browser automation can also await `window.runCanvasChecks()`; failures reject and successful results are available in `window.canvasResults`.

The harness bundles a real app and runs it under the production iframe runtime, opaque origin, sandbox flags, and CSP. It checks denied surfaces, overlapping SDK calls, incorrect dimensions, a producer ignoring backpressure, and revocation. Throughput cases fill a pixel buffer and call `putImageData`, transfer the resulting frame, and await host presentation. A final pixel readback verifies the output. It also checks that frame traffic creates no additional component snapshots and that measured presentation respects the host cap.

A local Chromium 154 run on 2026-10-19, with 120 measured frames per case after warm-up, produced:

- 320×200: 60.00 FPS; p95 producer-to-ack frame time 17.4 ms.
- 1280×720: 60.03 FPS; p95 frame time 17.5 ms.
- 1920×1080: 60.02 FPS; p95 frame time 17.7 ms.
- 320×200 with a 30 FPS host cap: 30.00 FPS; p95 frame time 34.0 ms.

Each case produced one initial component snapshot. The measured browser ran at approximately 60 Hz; the 240 FPS test cap avoids an additional host throttle and does not claim 240 FPS support. These are local observations, not portable performance thresholds or a game benchmark. The reported equivalent MB/s is `width × height × 4 × FPS`; it is a pixel-volume calculation, not measured IPC bandwidth or proof of zero-copy transfer. Other browsers/devices still need verification.

A follow-up local run on 2026-10-20 with approximately 120 Hz browser scheduling also passed all nine cases: 120.85 FPS at 320×200, 120.83 FPS at 1280×720, and 119.93 FPS at 1920×1080 (p95 frame times 9.0–9.2 ms). The 30 FPS cap case averaged 29.23 FPS. These differing runs demonstrate the effect of scheduling and refresh rate; neither establishes a guaranteed throughput floor.
