import * as v from "valibot";

import { componentRecord } from "./component";
import { viewRecord } from "./view";

const toolLeaf = v.strictObject({
  input: v.optional(v.record(v.string(), v.unknown())),
  kind: v.picklist(["client", "server"]),
  output: v.optional(v.record(v.string(), v.unknown())),
});

interface ToolRecord {
  [key: string]: v.InferOutput<typeof toolLeaf> | ToolRecord;
}

const toolRecord: v.GenericSchema<unknown, ToolRecord> = v.lazy(() =>
  v.record(v.string(), v.union([toolLeaf, toolRecord]))
);

const TailorKitSchemaSpecSchema = v.pipe(
  v.strictObject({
    components: componentRecord,
    scopes: v.optional(v.record(v.string(), v.record(v.string(), v.unknown()))),
    slots: v.optional(
      v.record(
        v.pipe(v.string(), v.minLength(1)),
        v.object({
          description: v.optional(v.string()),
          multiple: v.optional(v.boolean()),
          views: v.array(v.pipe(v.string(), v.startsWith("/"))),
        })
      ),
      () => ({})
    ),
    tools: v.optional(toolRecord, () => ({})),
    version: v.literal(1),
    views: v.optional(viewRecord, () => ({})),
  }),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) {
      return;
    }
    const schema = dataset.value;
    for (const [name, slot] of Object.entries(schema.slots)) {
      for (const [index, view] of slot.views.entries()) {
        if (!Object.hasOwn(schema.views, view)) {
          addIssue({
            message: `Unknown view "${view}".`,
            path: [
              {
                input: schema,
                key: "slots",
                origin: "value",
                type: "object",
                value: schema.slots,
              },
              {
                input: schema.slots,
                key: name,
                origin: "value",
                type: "object",
                value: slot,
              },
              {
                input: slot,
                key: "views",
                origin: "value",
                type: "object",
                value: slot.views,
              },
              {
                input: slot.views,
                key: index,
                origin: "value",
                type: "array",
                value: view,
              },
            ],
          });
        }
      }
    }
  })
);

export type TailorKitSchemaSpec = v.InferOutput<
  typeof TailorKitSchemaSpecSchema
>;

export { TailorKitSchemaSpecSchema as TailorKitSchemaSpec };
