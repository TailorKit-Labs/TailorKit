import * as v from "valibot";

import { JsonSchema } from "./json-schema";

const viewKeyPattern = /^\/.*$/u;

const viewKeySchema = v.pipe(
  v.string(),
  v.regex(viewKeyPattern, 'View keys must start with "/".')
);

const SerializedView = v.strictObject({
  context: v.optional(JsonSchema),
  contextOptional: v.optional(v.boolean()),
});

export const viewRecord = v.record(viewKeySchema, SerializedView);
