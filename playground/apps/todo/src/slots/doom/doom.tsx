import { useState } from "preact/hooks";
import { experimental_useCanvasSurface } from "tailorkit/client";

import { Box, experimental_DoomCanvas as Canvas, Flex } from "#tailorkit";

import { createDoomGame, disposeDoomGame, drawDoomGame } from "./doom-game";
import type { DoomGame } from "./doom-game";

const width = 320;
const height = 200;

export const Doom = () => {
  const [stats, setStats] = useState("Starting DoomGeneric…");
  const [held, setHeld] = useState("none");
  const surface = experimental_useCanvasSurface<DoomGame>(
    {
      create: async (canvas, { signal }) =>
        await createDoomGame(canvas, signal, setHeld),
      dispose: disposeDoomGame,
      draw: (game) => {
        drawDoomGame(game, setStats);
      },
    },
    [],
    { continuous: true, preserveDrawingBuffer: true }
  );
  return (
    <Flex direction="column" gap="sm">
      <Box>DoomGeneric · Freedoom Phase 1</Box>
      <Box>
        Click the game to focus. Arrows: move/turn · W/S: forward/back · A/D:
        strafe · Space: fire · E: use · M: menu · Enter: select. Tab leaves the
        game.
      </Box>
      <Canvas
        ariaLabel="DoomGeneric running Freedoom Phase 1; keyboard controls listed above"
        width={width}
        height={height}
        surface={surface.binding}
      />
      <Box>{surface.error?.message ?? `Doom ${surface.status}`}</Box>
      <Box>{stats}</Box>
      <Box>Game keys held: {held}</Box>
    </Flex>
  );
};
