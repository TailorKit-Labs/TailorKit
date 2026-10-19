import * as v from "valibot";

const coordinate = v.pipe(
  v.number(),
  v.finite(),
  v.minValue(0),
  v.maxValue(4096)
);
const InputEvent = v.variant("type", [
  v.strictObject({
    button: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(5)),
    buttons: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(31)),
    event: v.picklist([
      "pointermove",
      "pointerdown",
      "pointerup",
      "pointerleave",
      "click",
    ]),
    pointerId: v.pipe(v.number(), v.integer()),
    pointerType: v.picklist(["mouse", "pen", "touch"]),
    shiftKey: v.boolean(),
    type: v.literal("pointer"),
    x: coordinate,
    y: coordinate,
  }),
  v.strictObject({
    code: v.pipe(v.string(), v.maxLength(32)),
    event: v.picklist(["keydown", "keyup"]),
    key: v.pipe(v.string(), v.maxLength(64)),
    repeat: v.boolean(),
    shiftKey: v.boolean(),
    type: v.literal("key"),
  }),
  v.strictObject({ type: v.picklist(["focus", "blur"]) }),
]);

export type experimental_CanvasInputEvent = v.InferOutput<typeof InputEvent>;

export const CanvasInputBatch = v.strictObject({
  events: v.pipe(v.array(InputEvent), v.maxLength(32)),
  sequence: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(Number.MAX_SAFE_INTEGER)
  ),
  type: v.literal("input"),
});

/** Only local, untrusted events are created; no host Event or DOM reference crosses the port. */
export const createCanvasInput = (canvas: OffscreenCanvas) => {
  const keys = new Map<
    string,
    Extract<experimental_CanvasInputEvent, { type: "key" }>
  >();
  const reset = () => {
    for (const key of keys.values()) {
      canvas.dispatchEvent(
        new KeyboardEvent("keyup", { code: key.code, key: key.key })
      );
    }
    keys.clear();
    canvas.dispatchEvent(new PointerEvent("pointercancel"));
    canvas.dispatchEvent(new Event("blur"));
    canvas.dispatchEvent(new MouseEvent("mouseout"));
  };
  return {
    dispatch: (input: experimental_CanvasInputEvent) => {
      if (input.type === "blur") {
        reset();
      } else if (input.type === "focus") {
        canvas.dispatchEvent(new Event("focus"));
      } else if (input.type === "key") {
        if (input.event === "keydown") {
          keys.set(input.code, input);
        } else {
          keys.delete(input.code);
        }
        canvas.dispatchEvent(new KeyboardEvent(input.event, input));
      } else if (input.type === "pointer") {
        const init = { ...input, clientX: input.x, clientY: input.y };
        canvas.dispatchEvent(new PointerEvent(input.event, init));
        const mouseEvent = {
          click: "click",
          pointerdown: "mousedown",
          pointerleave: "mouseout",
          pointermove: "mousemove",
          pointerup: "mouseup",
        }[input.event];
        // Mouse compatibility events support canvas libraries' existing listeners.
        if (input.event !== "click") {
          canvas.dispatchEvent(new MouseEvent(mouseEvent, init));
        }
      }
    },
    reset,
  };
};
