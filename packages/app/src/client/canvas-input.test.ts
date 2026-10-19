// @vitest-environment happy-dom
import * as v from "valibot";
import { expect, it } from "vite-plus/test";

import { CanvasInputBatch, createCanvasInput } from "./canvas-input";

const createTarget = () => {
  const target = new EventTarget();
  // SAFETY: Input dispatch uses only EventTarget; actual graphics surfaces are exercised in the browser harness.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This injected fixture never performs graphics operations.
  return target as OffscreenCanvas;
};

it("delivers local pointer and mouse events with backing coordinates", () => {
  const canvas = createTarget();
  const input = createCanvasInput(canvas);
  const events: { type: string; x: number; y: number }[] = [];
  for (const type of ["pointermove", "mousemove", "click"]) {
    canvas.addEventListener(type, (event) => {
      if (event instanceof MouseEvent) {
        events.push({
          type: event.type,
          x: event.clientX,
          y: event.clientY,
        });
      }
    });
  }
  const pointer = {
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: "mouse",
    shiftKey: false,
    type: "pointer",
    x: 50,
    y: 60,
  } as const;
  input.dispatch({ ...pointer, event: "pointermove" });
  input.dispatch({ ...pointer, event: "click" });
  expect(events).toEqual([
    { type: "pointermove", x: 50, y: 60 },
    { type: "mousemove", x: 50, y: 60 },
    { type: "click", x: 50, y: 60 },
  ]);
});

it("synthesizes key releases and clears pointer state when focus is lost", () => {
  const canvas = createTarget();
  const input = createCanvasInput(canvas);
  const events: string[] = [];
  for (const type of [
    "keydown",
    "keyup",
    "pointercancel",
    "blur",
    "mouseout",
  ]) {
    canvas.addEventListener(type, (event) => {
      events.push(event.type);
    });
  }
  input.dispatch({
    code: "KeyW",
    event: "keydown",
    key: "w",
    repeat: false,
    shiftKey: false,
    type: "key",
  });
  input.dispatch({ type: "blur" });
  expect(events).toEqual([
    "keydown",
    "keyup",
    "pointercancel",
    "blur",
    "mouseout",
  ]);
  events.length = 0;
  input.reset();
  expect(events).toEqual(["pointercancel", "blur", "mouseout"]);
});

it("rejects oversized, non-finite, and malformed input batches", () => {
  const valid = { events: [{ type: "blur" }], sequence: 1, type: "input" };
  expect(v.safeParse(CanvasInputBatch, valid).success).toBe(true);
  for (const invalid of [
    { ...valid, events: Array.from({ length: 33 }, () => ({ type: "blur" })) },
    { ...valid, sequence: Infinity },
    { ...valid, events: [{ type: "pointer", x: Number.NaN }] },
    {
      ...valid,
      events: [
        {
          code: "KeyW",
          event: "keydown",
          key: "w".repeat(65),
          repeat: false,
          shiftKey: false,
          type: "key",
        },
      ],
    },
    { ...valid, dom: "not allowed" },
  ]) {
    expect(v.safeParse(CanvasInputBatch, invalid).success).toBe(false);
  }
});
