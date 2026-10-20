import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { JsonSchema } from "./json-schema";

describe("JSON Schema spec", () => {
  it.each([
    { name: "integer", schema: z.int() },
    { name: "record", schema: z.record(z.string(), z.number().nullable()) },
    { name: "fixed tuple", schema: z.tuple([z.string(), z.number()]) },
    {
      name: "optional tuple",
      schema: z.tuple([z.string(), z.number().optional()]),
    },
    {
      name: "rest tuple",
      schema: z.tuple([z.string()], z.number().nullable()),
    },
    {
      name: "nullable tuple",
      schema: z.tuple([z.string(), z.boolean()]).nullable(),
    },
  ])("preserves serialized $name schemas", ({ schema }) => {
    const serialized = schema["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    });

    expect(v.parse(JsonSchema, serialized)).toEqual(serialized);
  });

  it("preserves local definitions and references", () => {
    const schema = {
      $defs: { value: { enum: ["one", "two"], type: "string" } },
      properties: { value: { $ref: "#/$defs/value" } },
      type: "object",
    };

    expect(v.parse(JsonSchema, schema)).toEqual(schema);
    expect(
      v.safeParse(JsonSchema, { $defs: { value: { "x-unsupported": true } } })
        .success
    ).toBe(false);
    expect(v.safeParse(JsonSchema, { $ref: 42 }).success).toBe(false);
  });

  it("continues to reject unsupported keywords", () => {
    expect(
      v.safeParse(JsonSchema, { type: "string", "x-custom": true }).success
    ).toBe(false);
  });

  it.each([-1, 1.5])("rejects invalid tuple lengths: %s", (length) => {
    expect(
      v.safeParse(JsonSchema, { minItems: length, type: "array" }).success
    ).toBe(false);
    expect(
      v.safeParse(JsonSchema, { maxItems: length, type: "array" }).success
    ).toBe(false);
  });
});
