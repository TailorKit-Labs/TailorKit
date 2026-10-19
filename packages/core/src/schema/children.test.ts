import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { SerializedComponent } from "#spec/component";

import { createPatchSmithSchema } from "./schema";

describe("component children contract", () => {
  it("serializes containers and leaves with a boolean children capability", () => {
    const schema = createPatchSmithSchema({
      components: {
        Card: { children: true },
        Image: { children: false },
        Input: {},
      },
    }).serialize();
    expect(schema.components.Card).toEqual({
      callbacks: {},
      children: true,
      fields: undefined,
    });
    expect(schema.components.Input).toEqual({
      callbacks: {},
      children: false,
      fields: undefined,
    });
    expect(schema.components.Image).toEqual({
      callbacks: {},
      children: false,
      fields: undefined,
    });
    for (const component of Object.values(schema.components)) {
      expect(v.parse(SerializedComponent, component)).toEqual(component);
    }
  });
});
