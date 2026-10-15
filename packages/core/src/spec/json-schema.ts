import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";

const JSONType = z.enum([
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
const JsonSchemaSchema: z.ZodType<
  ReturnType<StandardJSONSchemaV1.Converter["output"]>
> = z
  .object({
    $schema: z
      .enum(["https://json-schema.org/draft/2020-12/schema"])
      .optional(),
    additionalProperties: z
      .union([z.boolean(), z.lazy(() => JsonSchemaSchema)])
      .optional(),
    allOf: z.lazy(() => z.array(JsonSchemaSchema)).optional(),
    anyOf: z.lazy(() => z.array(JsonSchemaSchema)).optional(),
    const: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.union([z.boolean(), z.lazy(() => JsonSchemaSchema)]).optional(),
    maxItems: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    maximum: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    minimum: z.number().optional(),
    not: z.lazy(() => JsonSchemaSchema).optional(),
    oneOf: z.lazy(() => z.array(JsonSchemaSchema)).optional(),
    pattern: z.string().optional(),
    prefixItems: z.lazy(() => z.array(JsonSchemaSchema)).optional(),
    properties: z.lazy(() => z.record(z.string(), JsonSchemaSchema)).optional(),
    propertyNames: z.lazy(() => JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    type: z.union([JSONType, z.array(z.string())]).optional(),
  })
  .strict();

export type JsonSchema = z.infer<typeof JsonSchemaSchema>;

export { JsonSchemaSchema as JsonSchema };
