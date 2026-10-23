import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from "chart.js";
import type { ChartItem } from "chart.js";
import { experimental_useCanvasSurface as useCanvasSurface } from "patchsmith/client";
import { useState } from "preact/hooks";

import { Box, Button, experimental_Canvas as Canvas, Flex } from "#patchsmith";

import { CanvasChartPlatform } from "./canvas-chart-platform";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip
);

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
  const [hovered, setHovered] = useState("none");
  const [heldKeys, setHeldKeys] = useState("none");

  const surface = useCanvasSurface<ChartJS<"bar", number[], string>>(
    {
      create: (canvas, { signal }) => {
        const keys = new Set<string>();

        const key = (event: Event) => {
          if (!(event instanceof KeyboardEvent)) {
            return;
          }

          if (event.type === "keydown") {
            keys.add(event.code);
          } else {
            keys.delete(event.code);
          }

          setHeldKeys([...keys].join(", ") || "none");
        };

        canvas.addEventListener("keydown", key, { signal });
        canvas.addEventListener("keyup", key, { signal });
        canvas.addEventListener(
          "mouseout",
          () => {
            setHovered("none");
          },
          { signal }
        );
        // SAFETY: Chart.js documents OffscreenCanvas support, but ChartItem omits it. The platform uses the canvas's local EventTarget and 2D context.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- Chart.js's input type omits its supported OffscreenCanvas input.
        const item = canvas as unknown as ChartItem;

        const chart = new ChartJS<"bar", number[], string>(item, {
          data: {
            datasets: [{ backgroundColor: "#65b5ff", data: [] }],
            labels: ["Jan", "Feb", "Mar", "Apr", "May"],
          },
          options: {
            animation: false,
            devicePixelRatio: 1,
            events: ["mousemove", "mouseout", "click"],
            maintainAspectRatio: false,
            onHover: (_event, elements) => {
              const [first] = elements;
              setHovered(
                first === undefined
                  ? "none"
                  : (chart.data.labels?.[first.index] ?? "none")
              );
            },
            responsive: false,
            scales: {
              x: { ticks: { color: "#cbd5e1" } },
              y: { max: 180, min: 0, ticks: { color: "#cbd5e1" } },
            },
          },
          platform: CanvasChartPlatform,
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

        onInstanceCountChange(Object.keys(ChartJS.instances).length);

        return chart;
      },
      dispose: (chart) => {
        chart.destroy();
        onInstanceCountChange(Object.keys(ChartJS.instances).length);
      },
      draw: (chart, _canvas, { timestamp }) => {
        if (continuous) {
          const animation = Math.floor(timestamp / 25);
          const [dataset] = chart.data.datasets;
          dataset.data = [45, 90, 65, 120, 80].map(
            (value) => ((value + revision * 19 + animation) % 150) + 20
          );
          chart.update("none");
        }
      },
      resize: (chart, { width, height }) => {
        chart.resize(width, height);
      },
      update: (chart) => {
        const [dataset] = chart.data.datasets;
        dataset.data = [45, 90, 65, 120, 80].map(
          (value) => ((value + revision * 19) % 150) + 20
        );
        chart.update("none");
      },
    },
    [revision, continuous],
    { continuous, framesPerSecond: 30 }
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
      <Box>Hovered: {hovered}</Box>
      <Box>Held keys: {heldKeys}</Box>
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
    <Flex direction="column" gap="2">
      <Box>Experimental sandbox canvas · Chart.js {ChartJS.version}</Box>
      <Flex gap="2" wrap="wrap">
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
