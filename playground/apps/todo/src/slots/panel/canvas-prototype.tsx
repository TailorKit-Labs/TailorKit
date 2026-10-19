import {
  BarController,
  BarElement,
  BasicPlatform,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
} from "chart.js";
import type { ChartItem } from "chart.js";
import { useEffect, useMemo, useState } from "preact/hooks";
import { experimental_useCanvasSurface as useCanvasSurface } from "tailorkit/client";

import { Box, Button, experimental_Canvas as Canvas, Flex } from "#tailorkit";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale);

interface ChartInstance {
  canvas: OffscreenCanvas;
  chart: ChartJS<"bar", number[], string>;
}

const createChartRenderer = (
  onInstanceCountChange: (count: number) => void
) => {
  let instance: ChartInstance | null = null;
  return {
    destroy: () => {
      instance?.chart.destroy();
      instance = null;
      onInstanceCountChange(Object.keys(ChartJS.instances).length);
    },
    draw: (canvas: OffscreenCanvas, values: number[]) => {
      if (instance?.canvas !== canvas) {
        instance?.chart.destroy();
        instance = null;
        // SAFETY: Chart.js documents OffscreenCanvas support, but ChartItem omits it. BasicPlatform acquires its 2D context without DOM access.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- Chart.js's published input type omits its supported OffscreenCanvas input.
        const item = canvas as unknown as ChartItem;
        const chart = new ChartJS<"bar", number[], string>(item, {
          data: {
            datasets: [{ backgroundColor: "#65b5ff", data: values }],
            labels: ["Jan", "Feb", "Mar", "Apr", "May"],
          },
          options: {
            animation: false,
            devicePixelRatio: 1,
            events: [],
            maintainAspectRatio: false,
            responsive: false,
            scales: {
              x: { ticks: { color: "#cbd5e1" } },
              y: { max: 180, min: 0, ticks: { color: "#cbd5e1" } },
            },
          },
          platform: BasicPlatform,
          plugins: [
            {
              beforeDraw: ({ ctx, width, height }) => {
                ctx.save();
                ctx.fillStyle = "#162032";
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
              },
              id: "opaque-background",
            },
          ],
          type: "bar",
        });
        instance = { canvas, chart };
        onInstanceCountChange(Object.keys(ChartJS.instances).length);
        return;
      }
      const { chart } = instance;
      const [dataset] = chart.data.datasets;
      dataset.data = values;
      // Bitmap transfer clears the source, so redraw the complete chart each time.
      chart.update("none");
    },
  };
};

const Chart = ({
  expanded,
  revision,
  continuous,
  onInstanceCountChange,
}: {
  expanded: boolean;
  revision: number;
  continuous: boolean;
  onInstanceCountChange: (count: number) => void;
}) => {
  const renderer = useMemo(
    () => createChartRenderer(onInstanceCountChange),
    [onInstanceCountChange]
  );
  useEffect(
    () => () => {
      renderer.destroy();
    },
    [renderer]
  );
  const surface = useCanvasSurface(
    (canvas) => {
      const animation = continuous ? Math.floor(performance.now() / 25) : 0;
      const values = [45, 90, 65, 120, 80].map(
        (value) => ((value + revision * 19 + animation) % 150) + 20
      );
      renderer.draw(canvas, values);
    },
    [revision, continuous, renderer],
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
  const [instanceCount, setInstanceCount] = useState(0);
  return (
    <Flex direction="column" gap="sm">
      <Box>Experimental sandbox canvas · Chart.js {ChartJS.version}</Box>
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
          onInstanceCountChange={setInstanceCount}
          revision={revision}
        />
      ) : null}
      <Box>Active Chart.js instances: {instanceCount}</Box>
    </Flex>
  );
};
