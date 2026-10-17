import * as v from "valibot";

import { JsonSchema } from "./json-schema";

const SerializedCallbackSchema = v.object({
  async: v.optional(v.boolean()),
  input: v.optional(JsonSchema),
  output: v.optional(JsonSchema),
});

export type SerializedCallback = v.InferOutput<typeof SerializedCallbackSchema>;

const SerializedComponentSchema = v.object({
  callbacks: v.record(v.string(), SerializedCallbackSchema),
  children: v.boolean(),
  fields: v.optional(JsonSchema),
});

export type SerializedComponent = v.InferOutput<
  typeof SerializedComponentSchema
>;

export const componentRecord = v.record(v.string(), SerializedComponentSchema);

export { SerializedCallbackSchema as SerializedCallback };

export { SerializedComponentSchema as SerializedComponent };
