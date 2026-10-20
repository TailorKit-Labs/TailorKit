---
"@patchsmith/app": minor
"@patchsmith/sandbox": minor
"patchsmith": minor
"@patchsmith/core": minor
"@patchsmith/react": minor
"@patchsmith/client-core": minor
---

Add experimental opt-in canvas surfaces to the low-level iframe sandbox. Hosts register named canvases; apps render with OffscreenCanvas and transfer complete ImageBitmap frames over a dedicated, backpressured channel. The host validates frame dimensions, limits presentation rate, and can revoke surfaces without granting app code access to host DOM.

Expose experimental_canvas() contract declarations, experimental_canvasRenderer for React hosts, and experimental_useCanvasSurface() for apps, with automatic mounting, resize, dependency redraws, and cleanup. Prefix all canvas public APIs and types with experimental_, including the low-level experimental_requestCanvas() and experimental_registerCanvas() APIs.

Add create/resize/update/draw/dispose lifecycles with separate creation and update dependencies with cancellation, bounded recovery, invalidation, and optional preserved drawing buffers. Hosts can opt into bounded pointer events and focused, allowlisted keyboard input; apps receive local synthetic canvas events without host DOM references or privileged host operations.

Add optional app-requested frame rates and timestamp/deltaTime draw contexts. Returning false from a draw callback skips bitmap creation and presentation; continuous skipped frames yield and pending scheduling waits cancel on teardown. Existing void-returning callbacks retain their behavior.

Permit JavaScript string evaluation and WebAssembly compilation with unsafe-eval inside the opaque-origin iframe. Host DOM isolation, host capability validation, and the worker ban remain enforced.
