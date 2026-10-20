import * as v from "valibot";
import { describe, expect, it, vi } from "vite-plus/test";

import { PatchsmithSchemaSpec } from "#spec/index";

import { experimental_canvas } from "./canvas";
import { createPatchsmithSchema } from "./schema";

const props = {
  ariaLabel: "Revenue chart",
  height: 200,
  surface: "surface",
  width: 320,
};

describe("experimental_canvas", () => {
  it("validates props and enforces host pixel limits", async () => {
    const { fields } = experimental_canvas({ maxPixels: 64_000 });
    expect(await fields["~standard"].validate(props)).toEqual({ value: props });
    await Promise.all(
      [
        { ...props, width: 321 },
        { ...props, width: 0 },
        { ...props, height: 0.5 },
        { ...props, ariaLabel: " " },
        { ...props, surface: "" },
        { ...props, width: Infinity },
      ].map(async (invalid) => {
        const result = await fields["~standard"].validate(invalid);
        expect(result.issues).toBeDefined();
      })
    );
  });

  it("rejects unknown props, including host-only policy fields", async () => {
    const { fields } = experimental_canvas();

    const result = await fields["~standard"].validate({
      ...props,
      maxFramesPerSecond: 1000,
    });

    expect(result.issues).toBeDefined();
  });

  it.each([
    { maxPixels: 0 },
    { maxPixels: 4_194_305 },
    { maxFramesPerSecond: 241 },
    { maxFramesPerSecond: Number.NaN },
  ])("rejects invalid host policy %j", (policy) => {
    expect(() => experimental_canvas(policy)).toThrow("policy");
  });

  it("serializes with the native Patchsmith converter even when a host supplies a different validator converter", () => {
    const definition = experimental_canvas();

    const converter = vi.fn(() => {
      throw new Error("Host converter cannot parse Patchsmith schemas.");
    });

    const schema = createPatchsmithSchema({
      components: { experimental_Canvas: definition },
    }).serialize(converter);

    expect(v.safeParse(PatchsmithSchemaSpec, schema).success).toBe(true);
    expect(schema.components.experimental_Canvas?.fields?.required).toContain(
      "surface"
    );
    expect(converter).not.toHaveBeenCalled();
    expect(definition.experimental_canvas.maxFramesPerSecond).toBe(60);
  });
});

it("keeps input disabled by default and validates immutable host input grants", () => {
  expect(experimental_canvas().experimental_canvas.input).toBeUndefined();

  for (const code of [
    "Tab",
    "Escape",
    "MetaLeft",
    "ControlLeft",
    "AltLeft",
    "invalid",
  ]) {
    expect(() =>
      experimental_canvas({ input: { keyboard: [code] } })
    ).toThrow();
  }

  const keyboard = ["ArrowLeft", "KeyW"];

  const policy = experimental_canvas({
    input: { keyboard, pointer: true },
  }).experimental_canvas;

  keyboard.push("Tab");
  expect(policy.input?.keyboard).toEqual(["ArrowLeft", "KeyW"]);
  expect(Object.isFrozen(policy.input)).toBe(true);
  expect(Object.isFrozen(policy.input?.keyboard)).toBe(true);
});
