import { z } from "zod";

import { JsonSchema } from "./json-schema";

export const SerializedCallback = z.object({
  async: z.boolean().optional(),
  input: JsonSchema.optional(),
  output: JsonSchema.optional(),
});

export type SerializedCallback = z.infer<typeof SerializedCallback>;

export const SerializedComponent = z.object({
  callbacks: z.record(z.string(), SerializedCallback),
  children: z.boolean(),
  fields: JsonSchema.optional(),
});

export type SerializedComponent = z.infer<typeof SerializedComponent>;

export const componentRecord = z.record(z.string(), SerializedComponent);
