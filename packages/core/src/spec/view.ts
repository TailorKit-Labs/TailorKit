import { z } from "zod";

import { JsonSchema } from "./json-schema";

const viewKeyPattern = /^\/.*$/u;

const viewKeySchema = z.string().regex(viewKeyPattern, {
  message: 'View keys must start with "/".',
});

const SerializedView = z
  .object({
    context: JsonSchema.optional(),
    contextOptional: z.boolean().optional(),
  })
  .strict();

export const viewRecord = z.record(viewKeySchema, SerializedView);
