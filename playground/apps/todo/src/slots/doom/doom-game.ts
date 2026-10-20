import type { experimental_CanvasFrame } from "tailorkit/client";
import createDoom, { wadBase64 } from "virtual:doomgeneric";

const keyCodes = new Map([
  ["ArrowUp", 0xad],
  ["ArrowDown", 0xaf],
  ["ArrowLeft", 0xac],
  ["ArrowRight", 0xae],
  ["KeyW", 0xad],
  ["KeyS", 0xaf],
  ["KeyA", 0xa0],
  ["KeyD", 0xa1],
  ["Space", 0xa3],
  ["KeyE", 0xa2],
  ["Enter", 13],
  ["KeyM", 27],
]);
const width = 320;
const height = 200;

export const createDoomGame = async (
  canvas: OffscreenCanvas,
  signal: AbortSignal,
  reportHeld: (keys: string) => void
) => {
  const engine = await createDoom({
    print: console.info,
    printErr: console.error,
  });
  signal.throwIfAborted();
  const compressed = Uint8Array.from(
    atob(wadBase64),
    (value) => value.codePointAt(0) ?? 0
  );
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const wad = new Uint8Array(await new Response(stream).arrayBuffer());
  signal.throwIfAborted();
  engine.FS.writeFile("/freedoom1.wad", wad);
  engine._dg_init();
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Doom requires a 2D canvas context.");
  }
  const keys = new Set<string>();
  const onKey = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.repeat) {
      return;
    }
    const code = keyCodes.get(event.code);
    if (code === undefined) {
      return;
    }
    const wasPressed = [...keys].some(
      (heldCode) => keyCodes.get(heldCode) === code
    );
    if (event.type === "keydown") {
      if (keys.has(event.code)) {
        return;
      }
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    const isPressed = [...keys].some(
      (heldCode) => keyCodes.get(heldCode) === code
    );
    if (wasPressed !== isPressed) {
      engine._dg_key(isPressed ? 1 : 0, code);
    }
    reportHeld([...keys].join(", ") || "none");
  };
  canvas.addEventListener("keydown", onKey, { signal });
  canvas.addEventListener("keyup", onKey, { signal });
  return {
    accumulatedTime: 1000 / 35,
    context,
    engine,
    lastStats: 0,
    pixels: new ImageData(width, height),
  };
};

export type DoomGame = Awaited<ReturnType<typeof createDoomGame>>;

export const drawDoomGame = (
  game: DoomGame,
  { timestamp, deltaTime }: experimental_CanvasFrame,
  reportStats: (stats: string) => void
) => {
  // Fixed-step simulation is game-specific; the surface supplies presentation timing.
  // Bound catch-up after a background pause to avoid a long blocking tick burst.
  game.accumulatedTime += Math.min(deltaTime, 100);
  if (game.accumulatedTime < 1000 / 35) {
    return false;
  }
  while (game.accumulatedTime >= 1000 / 35) {
    game.engine._dg_tick();
    game.accumulatedTime -= 1000 / 35;
  }
  const offset = game.engine._dg_framebuffer();
  const source = game.engine.HEAPU8;
  const target = game.pixels.data;
  for (let index = 0; index < target.length; index += 4) {
    target[index] = source[offset + index + 2];
    target[index + 1] = source[offset + index + 1];
    target[index + 2] = source[offset + index];
    target[index + 3] = 255;
  }
  game.context.putImageData(game.pixels, 0, 0);
  if (timestamp - game.lastStats > 500) {
    game.lastStats = timestamp;
    reportStats(
      `Frames: ${game.engine._dg_frames()} · Inputs: ${game.engine._dg_inputs()} · Position: ${game.engine._dg_x()}, ${game.engine._dg_y()}`
    );
  }
  return true;
};

export const disposeDoomGame = ({ engine }: DoomGame) => {
  // No engine timers, workers, audio, or native loop survive retirement.
  // Aborted listeners and the retired resource release the JS heap.
  engine.FS.unlink("/freedoom1.wad");
};
