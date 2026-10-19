import { BasicPlatform } from "chart.js";
import type { Chart, ChartEvent } from "chart.js";

/** Chart.js's documented platform extension point connects native local canvas events. */
export class CanvasChartPlatform extends BasicPlatform {
  private readonly listeners = new Map<Chart, Map<string, EventListener>>();

  override addEventListener(
    chart: Chart,
    type: string,
    listener: (event: ChartEvent) => void
  ) {
    if (type !== "mousemove" && type !== "mouseout" && type !== "click") {
      return;
    }
    this.removeEventListener(chart, type);
    const handler = (event: Event) => {
      if (event instanceof MouseEvent) {
        listener({ native: event, type, x: event.clientX, y: event.clientY });
      }
    };
    const handlers =
      this.listeners.get(chart) ?? new Map<string, EventListener>();
    handlers.set(type, handler);
    this.listeners.set(chart, handlers);
    chart.canvas.addEventListener(type, handler);
  }

  override removeEventListener(chart: Chart, type: string) {
    const handlers = this.listeners.get(chart);
    const handler = handlers?.get(type);
    if (handler) {
      chart.canvas.removeEventListener(type, handler);
      handlers?.delete(type);
    }
    if (handlers?.size === 0) {
      this.listeners.delete(chart);
    }
  }
}
