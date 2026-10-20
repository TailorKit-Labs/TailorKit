import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { primitives } from "#primitives/zod";
import { jsonSchemaSerializer, serializeSchema } from "#schema/shared";

import { JsonSchema } from "./json-schema";
import { compactJsonSchema, resolveJsonSchema } from "./schema-references";

const repeatedValue = {
  enum: [
    "surface",
    "muted",
    "accent",
    "strong",
    "disabled",
    "foreground",
    "subtle",
    "transparent",
    "inherited",
  ],
  type: "string",
};

it("compacts real primitive schemas and preserves their expanded meaning", () => {
  for (const component of Object.values(primitives())) {
    if (!component.fields) {
      throw new Error("Expected primitive fields.");
    }

    const original = jsonSchemaSerializer(component.fields);
    const compact = serializeSchema(component.fields, jsonSchemaSerializer);

    if (!original || !compact) {
      throw new Error("Expected serialized primitive schemas.");
    }

    expect(v.parse(JsonSchema, compact)).toEqual(compact);
    expect(resolveJsonSchema(compact)).toEqual(original);
    expect(JSON.stringify(compact).length).toBeLessThan(
      JSON.stringify(original).length / 3
    );
  }
});

it("preserves literal object data while deduplicating schema positions", () => {
  const schema = {
    enum: [repeatedValue, repeatedValue],
    properties: {
      first: { const: repeatedValue },
      second: { const: repeatedValue },
    },
    type: "object",
  };

  const compact = compactJsonSchema(schema);
  expect(compact.enum).toBe(schema.enum);
  expect(resolveJsonSchema(compact)).toEqual(schema);
});

it("keeps small schemas inline and does not mutate its input", () => {
  const schema = {
    properties: { first: { type: "string" }, second: { type: "string" } },
    type: "object",
  };

  expect(compactJsonSchema(schema)).toBe(schema);
  expect(schema).not.toHaveProperty("$defs");
});

it("preserves existing reference scopes without recompacting them", () => {
  const schema = {
    $defs: { value: repeatedValue },
    properties: { value: { $ref: "#/$defs/value" } },
    type: "object",
  };

  expect(compactJsonSchema(schema)).toBe(schema);
  expect(resolveJsonSchema(schema)).toEqual({
    properties: { value: repeatedValue },
    type: "object",
  });
});

it("resolves escaped names, URI fragments, array pointers, and chained references", () => {
  expect(
    resolveJsonSchema({
      $defs: {
        "a/b~c d": { type: "string" },
        alias: { $ref: "#/$defs/a~1b~0c%20d" },
      },
      $ref: "#/$defs/alias",
    })
  ).toEqual({ type: "string" });
  expect(
    resolveJsonSchema({
      items: { $ref: "#/prefixItems/0" },
      prefixItems: [{ type: "string" }],
      type: "array",
    })
  ).toEqual({
    items: { type: "string" },
    prefixItems: [{ type: "string" }],
    type: "array",
  });
});

it("retains constraints alongside a reference using intersection semantics", () => {
  expect(
    resolveJsonSchema({
      $defs: { value: { type: "string" } },
      properties: { value: { $ref: "#/$defs/value", enum: ["one", "two"] } },
      type: "object",
    })
  ).toEqual({
    properties: {
      value: { allOf: [{ type: "string" }, { enum: ["one", "two"] }] },
    },
    type: "object",
  });
});

describe("invalid schema references", () => {
  it.each([
    {
      message: "Only local JSON Schema references",
      reference: "https://example.com/schema.json",
    },
    {
      message: "Unresolved JSON Schema reference",
      reference: "#/$defs/missing",
    },
    { message: "Circular JSON Schema references", reference: "#" },
  ])("rejects $reference clearly", ({ reference, message }) => {
    expect(() => resolveJsonSchema({ $ref: reference })).toThrow(message);
  });
  it("detects indirect cycles", () => {
    expect(() =>
      resolveJsonSchema({
        $defs: {
          first: { $ref: "#/$defs/second" },
          second: { $ref: "#/$defs/first" },
        },
        $ref: "#/$defs/first",
      })
    ).toThrow("Circular JSON Schema references");
  });
});

it("preserves schemas from native ArkType and Valibot converters", () => {
  const arkValue = type({
    enabled: "boolean",
    first: "string",
    second: "number",
    values: "string[]",
  });

  const valibotValue = v.strictObject({
    enabled: v.boolean(),
    first: v.string(),
    second: v.number(),
    values: v.array(v.string()),
  });

  const schemas = [
    type({ first: arkValue, second: arkValue }),
    toStandardJsonSchema(
      v.strictObject({ first: valibotValue, second: valibotValue })
    ),
  ];

  for (const schema of schemas) {
    const original = jsonSchemaSerializer(schema);
    const compact = serializeSchema(schema, jsonSchemaSerializer);

    if (!original || !compact) {
      throw new Error("Expected a serialized native schema.");
    }

    expect(v.parse(JsonSchema, compact)).toEqual(compact);
    expect(resolveJsonSchema(compact)).toEqual(resolveJsonSchema(original));
    expect(JSON.stringify(compact).length).toBeLessThan(
      JSON.stringify(original).length
    );
  }
});
