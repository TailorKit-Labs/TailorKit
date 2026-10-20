import { defineView } from "patchsmith/client";

import { CanvasPrototype } from "#slots/panel/canvas-prototype";

export default defineView({
  component: CanvasPrototype,
  slot: "canvas",
  view: "/",
});
