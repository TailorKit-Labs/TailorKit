# DoomGeneric canvas demo

This is a sandbox-side wrapper for [DoomGeneric](https://github.com/ozkl/doomgeneric), using [Freedoom Phase 1](https://github.com/freedoom/freedoom/releases/tag/v0.13.0) game data. It exercises the existing experimental canvas lifecycle and host-approved keyboard input. The wrapper uses the canvas foundation from [PR #353](https://github.com/patchsmith-io/patchsmith/pull/353). This layer adds no SDK APIs, sandbox flags, CSP rules, or transport changes.

From the repository root, with Docker running:

```sh
pnpm --filter @playground/todo build:doom
pnpm playground:generate
pnpm playground:todo:build
pnpm --filter @tailorkit/ui build
pnpm --filter @playground/tanstack-start dev:canvas
```

Open http://127.0.0.1:5191/canvas-demo.html and select **Play Doom**. Click the game to focus it. Arrows move and turn, W/S move forward/back, A/D strafe, Space fires, E activates doors, M opens/closes the menu, and Enter selects. Tab leaves the game; blur releases held keys. The game starts directly in E1M1. **Back to charts** unmounts the game.

On a fresh page, `await window.experimental_runDoomChecks()` verifies real engine coordinates and host pixel changes after movement, focused key permissions, blur release, fire transitions, a simultaneous chart app, teardown/remount, and sandbox restart. The existing `experimental_runCanvasChecks()` suite remains available on its own fresh page.

`build.mjs` downloads checksum-verified DoomGeneric and Freedoom archives and uses a digest-pinned Emscripten 3.1.74 Docker image. The compiler container has no network. Downloaded sources, the patched source, game data, and generated runtime remain in the ignored `.cache/doomgeneric` directory. Run `build:doom` again after changing the C platform or compiler settings, then rebuild the Todo app. Without the optional generated runtime, the Todo app still builds and the Doom view displays setup instructions.

DoomGeneric's framebuffer is 320 × 200. The wrapper uses `create` to instantiate the engine, an in-memory filesystem for the WAD, and lifetime-bound keyboard listeners. `draw` uses the supplied frame timestamp/deltaTime to advance a fixed-step 35 Hz simulation, converts the BGRA framebuffer to ImageData, and draws to the sandbox OffscreenCanvas. It requests at most 35 FPS and returns false when no game tick has produced a new frame. Simulation catch-up is clamped to 100 ms after a long pause. The host presents the frames and permits only the game's key allowlist. Each produced frame is complete, so the wrapper uses transfer-and-clear mode without an additional preserved-buffer snapshot. Skipped draws leave the previous host frame visible. The diagnostics report real engine frame/input counters and fixed-point player coordinates.

The foundation permits JavaScript string evaluation and WebAssembly compilation inside the isolated iframe. This reference port continues to use plain JavaScript with Emscripten's `WASM=0` and `DYNAMIC_EXECUTION=0`; it requires neither feature and does not change that policy. The port has no native main loop, timers, workers, network, audio, pointer lock, or fullscreen. It disables the upstream blocking melt transition in its build-time source patch; gameplay and rendering remain the real DoomGeneric implementation. Disposing removes listeners through the hook's abort signal, unlinks the WAD, and lets the engine's JS heap be collected. It does not add hard CPU or memory quotas. This opt-in build embeds approximately 14 MB of engine and compressed game data in the app bundle; it is a capability demo, not a production distribution setup. Freedoom 0.13.0 warns about vanilla-engine compatibility; later maps are not verified.

The C platform is GPL-2.0-or-later; see `LICENSE`. DoomGeneric sources are pinned to commit `e257a09527062bfb986b6e5e0780839b6cbd5b71`, and the complete corresponding source plus the build-time patch are retained in the cache. If distributing the generated game bundle, include its corresponding sources, build instructions, and license notices. Freedoom data uses its BSD-style license; see `FREEDOOM-LICENSE.txt`. No proprietary Doom WAD is included.
