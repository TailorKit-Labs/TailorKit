# TailorKit sandbox

`@tailorkit/sandbox` runs TailorKit extensions in an opaque-origin iframe. Apps describe UI; the host owns the rendered DOM and sensitive capabilities.

## Experimental canvas surfaces

All public canvas APIs and types use the `experimental_` prefix. They may change while the API is being evaluated.

### Host contract and renderer

```tsx
import { defineContract, experimental_canvas } from "tailorkit";
import { createClient, experimental_canvasRenderer } from "tailorkit/react";
import { z } from "zod";

const contract = defineContract({
  components: {
    experimental_Canvas: experimental_canvas({
      maxPixels: 1_048_576,
      maxFramesPerSecond: 60,
      input: { pointer: true, keyboard: ["ArrowLeft", "ArrowRight"] },
    }),
  },
  views: { "/": z.object({}) },
  slots: { panel: { views: ["/"] } },
});

const tailor = createClient({
  contract,
  baseUrl: "/api/tailorkit/",
  components: { experimental_Canvas: experimental_canvasRenderer },
});
```

Use `tailor.Provider` and `tailor.RenderSlot` normally. The renderer binds each canvas to its mounted remote node and sandbox instance. It registers the visible element, enforces the contract policy, and revokes the old registration when dimensions change or the component unmounts. A generation identifier prevents stale requests from attaching to a replacement surface. App props cannot raise the host's limits.

### App hook and generated component

The normal generator produces `experimental_Canvas` from that contract. Alias the import for JSX, and alias the hook so hook lint rules recognize it:

```tsx
import { experimental_useCanvasSurface as useCanvasSurface } from "tailorkit/client";

import { experimental_Canvas as Canvas } from "#tailorkit";

const Chart = ({ value }: { value: number }) => {
  const surface = useCanvasSurface(
    (canvas) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D rendering is unavailable");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "royalblue";
      context.fillRect(0, canvas.height - value, canvas.width, value);
    },
    [value]
  );

  return (
    <Canvas
      surface={surface.binding}
      width={320}
      height={200}
      ariaLabel={`Sample value: ${value}`}
    />
  );
};
```

The hook returns `binding`, `status` (`pending`, `ready`, or `error`), `error`, `invalidate()`, and `retry()`. It waits for host registration, creates the sandbox's OffscreenCanvas, draws and presents once, and redraws on dependency or backing-dimension changes. `ready` means that the surface connection is available, rather than a physical display acknowledgement. Keep drawing dependencies stable in the same way as effect dependencies. Unmounting releases the connection; draw errors are exposed through `error` and a later dependency change can retry.

For a host-paced animation, pass `{ continuous: true }` as the third argument. Each iteration awaits the draw callback and host presentation before drawing another frame. Switching continuous mode off draws one final static frame. Drawing callbacks may return a promise; they should finish promptly and should not resize the OffscreenCanvas or retain it after teardown. The hook preserves the drawing buffer by default using `createImageBitmap`, so libraries can retain or incrementally update their pixels. This allocates a snapshot bitmap in addition to the source buffer. Pass `{ preserveDrawingBuffer: false }` for the original transfer-and-clear path when drawing complete frames and measuring throughput.

### Frame timing, skipped frames, and requested rate

Drawing callbacks receive an `experimental_CanvasFrame`: the simple form is `draw(canvas, frame)` and the library lifecycle form is `draw(resource, canvas, frame)`. `frame.timestamp` uses the sandbox's monotonic performance clock; `frame.deltaTime` is milliseconds since the previous draw callback, with zero for the first draw on each new connection. Timing includes skipped draw calls and may jump after a background pause. Applications decide how to clamp elapsed time or advance a fixed-step simulation.

Returning `false` (or a promise resolving to `false`) skips the bitmap snapshot and presentation entirely. Returning nothing preserves the existing behavior. This is useful for charts with unchanged data, incremental drawing libraries, and animations with no new pixels. `update` still runs when its dependencies change; only `draw` can skip presentation. An omitted lifecycle draw callback presents the pixels already drawn by update or input handlers.

Pass `framesPerSecond` in the hook options to request a lower scheduling cap, for example `{ continuous: true, framesPerSecond: 30 }`. It must be finite, greater than zero, and at most 240; invalid values throw a RangeError. This app-side limit applies to drawing and presentation attempts, including dependency changes and input. The host independently enforces its own maximum; requesting a higher rate cannot override it. It is a maximum requested rate, not a guaranteed cadence.

```tsx
const surface = experimental_useCanvasSurface(
  (canvas, { timestamp, deltaTime }) => {
    if (!animationNeedsFrame(timestamp)) return false;
    drawAnimation(canvas, timestamp, deltaTime);
  },
  [animation],
  { continuous: true, framesPerSecond: 30 }
);
```

The default path still relies on host acknowledgements for backpressure. A continuously skipped frame yields with a timer, at the requested interval or approximately 60 Hz by default, so skipping cannot create a tight microtask loop. Timers are used because the sandbox iframe is hidden. Pending waits are cancelled when the connection is retired, and repeated invalidations coalesce. Updating the requested rate takes effect after any existing wait finishes. These controls do not impose hard execution quotas on app code.

### Library lifecycle and native local input

For libraries, use an explicit lifecycle. The second argument contains **update dependencies**; `options.createDependencies` contains **creation dependencies** and defaults to `[]`.

```tsx
const surface = experimental_useCanvasSurface<ChartJS<"bar">>(
  {
    create: (canvas, { signal, invalidate }) => {
      // Create the library instance using the sandbox canvas.
      // Use { signal } for local listeners and invalidate() after external drawing.
      return createChart(canvas, { signal, invalidate });
    },
    resize: (chart, { width, height }) => {
      chart.resize(width, height);
    },
    update: (chart) => {
      chart.data = data;
      chart.update("none");
    },
    dispose: (chart) => {
      chart.destroy();
    },
  },
  [data],
  { createDependencies: [chartType] }
);
```

`create(canvas, { signal, invalidate })` returns the resource or a promise for it. For each grant, callbacks run in order: **create → resize → update → draw → present**. Only `create` is required. `resize(resource, { width, height })` receives the granted backing-pixel dimensions before the first update. `update(resource, canvas)` runs initially and when update dependencies change. Optional `draw(resource, canvas)` runs for each presentation, including input, explicit invalidation, and continuous animation; use it for per-frame rendering rather than ordinary data updates. With no draw callback, TailorKit presents the pixels already drawn by the library. Repeated invalidations coalesce while a presentation is pending. Updates and drawing are serialized; an update arriving during an async update is applied before drawing. Callbacks use current update/draw closures without recreating the instance.

Changing `createDependencies` aborts and disposes the old resource before requesting a replacement. Function identity changes alone do not recreate it. Resize still revokes the host registration and grants a new surface: the old resource is disposed, then the replacement runs create, resize, and update with the current data. The resize callback initializes each replacement's library dimensions; it does not preserve the old instance. Revocation, sandbox restart, and unmount also abort the creation signal and dispose the resource. Disposal uses the callback paired with that resource's create call. Async creation or resize results arriving after teardown are disposed without drawing. Async work must honor the signal; it cannot be forcibly stopped. Use an explicit resource type parameter when TypeScript cannot infer it from the object.

Register local canvas listeners inside create with `{ signal }` so they are removed at teardown. The context's `invalidate()` is bound to that resource's lifetime; calls from retired resources are ignored. The hook result's `invalidate()` targets the current surface. Call either when a library draws outside the normal callback. Dependency changes and forwarded input also schedule presentation, but input and invalidation do not rerun `update`. A closed connection gets one automatic retry per host registration, followed by an explicit `retry()` or recovery when the tab becomes visible. Repeated errors do not create an automatic reconnect loop.

Migration from the earlier experimental API: rename `setup` to `create` and `experimental_CanvasSetupContext` to `experimental_CanvasCreateContext`. Move data changes from `draw` to `update`; keep per-frame animation in `draw`. The positional dependencies now trigger `update` for lifecycle objects; the simple drawing-function form retains its existing behavior. Use `createDependencies` for values such as chart type that require a new instance.

Input is disabled by default and negotiated per connection, so SDKs that do not request native input continue receiving output-only surfaces. A host can grant `input.pointer` and an allowlist of `input.keyboard` physical key codes through the contract or low-level registration. Pointer coordinates are scaled from the visible canvas rectangle into its backing pixels. The sandbox's OffscreenCanvas receives synthetic `pointermove`, `pointerdown`, `pointerup`, `pointerleave`, and `click` events plus mouse compatibility events (`mousemove`, `mousedown`, `mouseup`, `mouseout`). These are local, untrusted events. Their `clientX`/`clientY` describe backing coordinates; they carry no host DOM target or reference. They do not grant browser user activation. DOM-dependent libraries still need their documented non-DOM platform integration; the Chart.js playground uses a small BasicPlatform extension to register local listeners and enables its ordinary on-canvas tooltip.

Keyboard events are forwarded only while that specific canvas is focused. Clicking a keyboard-enabled canvas focuses it, and it is reachable with Tab. Only approved keys may prevent browser defaults. Tab, Escape, control/meta/alt shortcuts, and global keyboard capture are excluded. Canvas/window focus loss, page hiding, input-queue overflow, and connection closure reset local held keys and pointer state. Pointer input does not grant pointer lock, fullscreen, global capture, text composition, clipboard, drag/drop, or wheel interception.

Input uses one acknowledged batch in flight, at most 32 queued transitions, and one latest pointer movement. Queues reset on overflow to prevent stuck controls. Incoming sandbox messages can acknowledge input; they cannot request focus or synthesize privileged host actions. Preventing defaults or stopping propagation on a local event does not affect the original host event.

### Low-level transport

The low-level `createIframeUiHost` API can grant named pixel surfaces. The sandbox draws into its own `OffscreenCanvas`, transfers completed `ImageBitmap` frames through a dedicated `MessagePort`, and waits for the host to present each frame. Frames bypass component serialization and React reconciliation. This is an explicit frame-transfer design; it does not transfer control of the visible host canvas to untrusted code.

The host registers an unused canvas before the app requests it:

```ts
const revoke = host.experimental_registerCanvas(
  "visualization",
  canvasElement,
  {
    maxFramesPerSecond: 60,
  }
);

// Revoke access, discard any pending frame, and clear the visible surface.
revoke();
```

The canvas must support `getContext("bitmaprenderer")` and must not already have a different context. The host controls its CSS size, accessible description, focus, and placement. Its backing dimensions are fixed for a registration; revoke and register again to change them.

Inside the app:

```ts
import { experimental_requestCanvas } from "tailorkit/client";

const surface = await experimental_requestCanvas("visualization");
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

The low-level API is useful for custom adapters; React hosts can use the contract and renderer above. Keyboard/pointer input requires the explicit grants described above. Audio and dedicated workers remain separate capabilities. WebAssembly compilation is permitted by the sandbox script policy described below.

## Limits and lifecycle

- A host can register eight surfaces per sandbox, each at most 4096 pixels per axis and 4,194,304 total pixels. Names must contain 1–128 characters. Duplicate names or elements within a sandbox are rejected.
- Each registration accepts one connection at a time and one pending frame. Frame dimensions and increasing sequence numbers are checked on the host. Oversized, malformed, or overlapping frames close the connection and release received bitmaps.
- Host presentation is gated by `requestAnimationFrame` and `maxFramesPerSecond` (default 60, accepted range 1–240). Background tabs may pause presentation. Registration rate limits persist across reconnections.
- The SDK rejects overlapping `present()` calls and changed source dimensions. Low-level `present()` transfers and clears the source by default; `present({ preserveDrawingBuffer: true })` snapshots it without clearing. Each surface exposes an AbortSignal for connection closure. Requests and presentations time out after 30 seconds. Hosts can revoke at any time; destroying the host closes every surface and removes the iframe.
- Apps receive pixel output capability only. They do not receive the host canvas, rendering context, DOM references, credentials, or an arbitrary host API. The iframe keeps `sandbox="allow-scripts"` without `allow-same-origin`. Its CSP permits inline/data scripts and `unsafe-eval` inside the opaque-origin sandbox, including JavaScript string evaluation and WebAssembly compilation. Workers remain blocked with `worker-src 'none'`. Evaluation does not grant access to the host DOM or bypass host bridge validation, but evaluated code receives the app's existing capabilities and can consume resources.

These limits bound accepted output and retained application queues, not all browser resources. An untrusted app can still consume CPU/GPU/memory or enqueue transport messages before disconnection; large bitmaps exist before the host can inspect them. An iframe is not a hard resource quota. Pixel content also needs an accessibility alternative supplied by the app/host, and may imitate UI within its allocated rectangle.

## Browser checks and throughput

Build the sandbox's dependencies from the repository root, then start the harness:

```sh
pnpm exec turbo run build --filter=@tailorkit/sandbox
pnpm --filter @tailorkit/sandbox bench:canvas
```

Open http://127.0.0.1:5190 and click **Run checks and throughput measurements**. Keep the tab visible. Browser automation can also await `window.runCanvasChecks()`; failures reject and successful results are available in `window.canvasResults`.

The harness bundles a real app and runs it under the production iframe runtime, opaque origin, sandbox flags, and CSP. It checks denied surfaces, overlapping SDK calls, buffer preservation and transfer clearing, output-only legacy connections, native input negotiation, incorrect dimensions, a producer ignoring backpressure, and revocation. Throughput cases fill a pixel buffer and call `putImageData`, transfer the resulting frame, and await host presentation. A final pixel readback verifies the output. It also checks that frame traffic creates no additional component snapshots and that measured presentation respects the host cap.

A local Chromium 154 run on 2026-10-19, with 120 measured frames per case after warm-up, produced:

- 320×200: 60.00 FPS; p95 producer-to-ack frame time 17.4 ms.
- 1280×720: 60.03 FPS; p95 frame time 17.5 ms.
- 1920×1080: 60.02 FPS; p95 frame time 17.7 ms.
- 320×200 with a 30 FPS host cap: 30.00 FPS; p95 frame time 34.0 ms.

Each case produced one initial component snapshot. The measured browser ran at approximately 60 Hz; the 240 FPS test cap avoids an additional host throttle and does not claim 240 FPS support. These are local observations, not portable performance thresholds or a game benchmark. The reported equivalent MB/s is `width × height × 4 × FPS`; it is a pixel-volume calculation, not measured IPC bandwidth or proof of zero-copy transfer. Other browsers/devices still need verification.

A follow-up local run on 2026-10-20 with approximately 120 Hz browser scheduling also passed all nine cases: 120.85 FPS at 320×200, 120.83 FPS at 1280×720, and 119.93 FPS at 1920×1080 (p95 frame times 9.0–9.2 ms). The 30 FPS cap case averaged 29.23 FPS. These differing runs demonstrate the effect of scheduling and refresh rate; neither establishes a guaranteed throughput floor.

## Try the complete experimental API

The playground has a canvas-only slot and a standalone host that uses the real generated bindings, app builder, `RenderSlot.Controlled`, and sandbox. From the repository root:

```sh
pnpm playground:generate
pnpm playground:todo:build
pnpm --filter @tailorkit/ui build
pnpm --filter @playground/tanstack-start dev:canvas
```

Open http://127.0.0.1:5191/canvas-demo.html. No database or TailorKit platform process is needed for this demo. Try redraw, resize, animation, hide/show, a second app instance, and sandbox restart. The ordinary Todo panel also contains the same chart.

From a freshly loaded standalone demo, browser automation can await `window.experimental_runCanvasChecks()`. It reads back real host pixels and checks dependency redraw, resize, unmount/remount, animation start/stop, hover and on-canvas tooltips with CSS-scaled coordinates, keyboard allowlists, focused key input, key release on blur, isolation between two app instances, sandbox restart, and iframe cleanup. It throws on failure. The existing low-level throughput harness remains available through `bench:canvas`.
