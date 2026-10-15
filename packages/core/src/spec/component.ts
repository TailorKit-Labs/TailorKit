import { z } from "zod";

import { JsonSchema } from "./json-schema";

const SerializedCallbackSchema = z.object({
  async: z.boolean().optional(),
  input: JsonSchema.optional(),
  output: JsonSchema.optional(),
});

export type SerializedCallback = z.infer<typeof SerializedCallbackSchema>;

const SerializedComponentSchema = z.object({
  callbacks: z.record(z.string(), SerializedCallbackSchema),
  children: z.boolean(),
  fields: JsonSchema.optional(),
});

export type SerializedComponent = z.infer<typeof SerializedComponentSchema>;

export const componentRecord = z.record(z.string(), SerializedComponentSchema);

export { SerializedCallbackSchema as SerializedCallback };

export { SerializedComponentSchema as SerializedComponent };
