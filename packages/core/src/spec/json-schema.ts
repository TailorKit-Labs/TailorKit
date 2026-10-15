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
// oxlint-disable-next-line no-redeclare -- The schema value and its inferred TypeScript type intentionally share the public name.
export const JsonSchema: z.ZodType<
  ReturnType<StandardJSONSchemaV1.Converter["output"]>
> = z
  .object({
    $schema: z
      .enum(["https://json-schema.org/draft/2020-12/schema"])
      .optional(),
    additionalProperties: z
      .union([z.boolean(), z.lazy(() => JsonSchema)])
      .optional(),
    allOf: z.lazy(() => z.array(JsonSchema)).optional(),
    anyOf: z.lazy(() => z.array(JsonSchema)).optional(),
    const: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.union([z.boolean(), z.lazy(() => JsonSchema)]).optional(),
    maxItems: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    maximum: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    minLength: z.number().int().nonnegative().optional(),
    minimum: z.number().optional(),
    not: z.lazy(() => JsonSchema).optional(),
    oneOf: z.lazy(() => z.array(JsonSchema)).optional(),
    pattern: z.string().optional(),
    prefixItems: z.lazy(() => z.array(JsonSchema)).optional(),
    properties: z.lazy(() => z.record(z.string(), JsonSchema)).optional(),
    propertyNames: z.lazy(() => JsonSchema).optional(),
    required: z.array(z.string()).optional(),
    type: z.union([JSONType, z.array(z.string())]).optional(),
  })
  .strict();

export type JsonSchema = z.infer<typeof JsonSchema>;
