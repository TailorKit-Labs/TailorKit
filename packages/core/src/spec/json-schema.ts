import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";

const JSONType = v.picklist([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

/**
 * Models the exact JSON Schema 2020-12 subset emitted by `z.toJSONSchema()`.
 * Strict — unknown keys (including `x-` extensions) are rejected.
 * We're being strict just so we know exactly what we're dealing with. If we need
 * to support additional schema features, we can add them incrementally.
 */
const JsonSchemaSchema: v.GenericSchema<
  unknown,
  ReturnType<StandardJSONSchemaV1.Converter["output"]>
> = v.strictObject({
  $defs: v.optional(v.lazy(() => v.record(v.string(), JsonSchemaSchema))),
  $ref: v.optional(v.string()),
  $schema: v.optional(
    v.picklist(["https://json-schema.org/draft/2020-12/schema"])
  ),
  additionalProperties: v.optional(
    v.union([v.boolean(), v.lazy(() => JsonSchemaSchema)])
  ),
  allOf: v.optional(v.lazy(() => v.array(JsonSchemaSchema))),
  anyOf: v.optional(v.lazy(() => v.array(JsonSchemaSchema))),
  const: v.optional(v.unknown()),
  enum: v.optional(v.array(v.unknown())),
  items: v.optional(v.union([v.boolean(), v.lazy(() => JsonSchemaSchema)])),
  maxItems: v.optional(
    v.pipe(v.pipe(v.number(), v.finite()), v.integer(), v.minValue(0))
  ),
  maximum: v.optional(v.pipe(v.number(), v.finite())),
  minItems: v.optional(
    v.pipe(v.pipe(v.number(), v.finite()), v.integer(), v.minValue(0))
  ),
  minimum: v.optional(v.pipe(v.number(), v.finite())),
  not: v.optional(v.lazy(() => JsonSchemaSchema)),
  oneOf: v.optional(v.lazy(() => v.array(JsonSchemaSchema))),
  prefixItems: v.optional(v.lazy(() => v.array(JsonSchemaSchema))),
  properties: v.optional(v.lazy(() => v.record(v.string(), JsonSchemaSchema))),
  propertyNames: v.optional(v.lazy(() => JsonSchemaSchema)),
  required: v.optional(v.array(v.string())),
  type: v.optional(v.union([JSONType, v.array(v.string())])),
});

export type JsonSchema = v.InferOutput<typeof JsonSchemaSchema>;

export { JsonSchemaSchema as JsonSchema };
