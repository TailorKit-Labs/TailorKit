import { z } from "zod";

import { JsonSchema } from "./json-schema";

const viewKeyPattern = /^\/.*$/u;

const ViewKey = z.string().regex(viewKeyPattern, {
  message: 'View keys must start with "/".',
});

type ViewKey = z.infer<typeof ViewKey>;

const SerializedView = z
  .object({
    context: JsonSchema.optional(),
    contextOptional: z.boolean().optional(),
  })
  .strict();

export const viewRecord = z.record(ViewKey, SerializedView);
