import { useState } from "preact/hooks";
import { experimental_useCanvasSurface as useCanvasSurface } from "tailorkit/client";

import { Box, Button, experimental_Canvas as Canvas, Flex } from "#tailorkit";

const Chart = ({
  expanded,
  revision,
  continuous,
}: {
  expanded: boolean;
  revision: number;
  continuous: boolean;
}) => {
  const surface = useCanvasSurface(
    (canvas) => {
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("2D rendering is unavailable.");
      }
      context.fillStyle = "#162032";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#65b5ff";
      const animation = continuous ? Math.floor(performance.now() / 25) : 0;
      const values = [45, 90, 65, 120, 80].map(
        (value) => ((value + revision * 19 + animation) % 150) + 20
      );
      for (const [index, value] of values.entries()) {
        context.fillRect(
          20 + (index * (canvas.width - 40)) / values.length,
          canvas.height - value - 15,
          (canvas.width - 60) / values.length,
          value
        );
      }
    },
    [revision, continuous],
    { continuous }
  );
  return (
    <>
      <Canvas
        ariaLabel="Five sample revenue bars; illustrative data"
        height={200}
        surface={surface.binding}
        width={expanded ? 640 : 320}
      />
      <Box>{surface.error?.message ?? `Canvas ${surface.status}`}</Box>
    </>
  );
};

export const CanvasPrototype = () => {
  const [continuous, setContinuous] = useState(false);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  return (
    <Flex direction="column" gap="sm">
      <Box>Experimental sandbox canvas</Box>
      <Flex gap="sm" wrap="wrap">
        <Button
          onClick={() => {
            setContinuous((value) => !value);
          }}
        >
          {continuous ? "Stop animation" : "Animate chart"}
        </Button>
        <Button
          onClick={() => {
            setRevision((value) => value + 1);
          }}
        >
          Redraw chart
        </Button>
        <Button
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          Resize chart
        </Button>
        <Button
          onClick={() => {
            setVisible((value) => !value);
          }}
        >
          {visible ? "Hide chart" : "Show chart"}
        </Button>
      </Flex>
      {visible ? (
        <Chart
          continuous={continuous}
          expanded={expanded}
          revision={revision}
        />
      ) : null}
    </Flex>
  );
};
