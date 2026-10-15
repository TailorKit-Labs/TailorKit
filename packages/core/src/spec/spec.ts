import { z } from "zod";

import { componentRecord } from "./component";
import { viewRecord } from "./view";

const toolLeaf = z.strictObject({
  input: z.record(z.string(), z.unknown()).optional(),
  kind: z.enum(["client", "server"]),
  output: z.record(z.string(), z.unknown()).optional(),
});

interface ToolRecord {
  [key: string]: z.infer<typeof toolLeaf> | ToolRecord;
}

const toolRecord: z.ZodType<ToolRecord> = z.lazy(() =>
  z.record(z.string(), z.union([toolLeaf, toolRecord]))
);

const TailorKitSchemaSpecSchema = z
  .strictObject({
    components: componentRecord,
    scopes: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    slots: z
      .record(
        z.string().min(1),
        z.object({
          multiple: z.boolean().optional(),
          views: z.array(z.string().startsWith("/")),
        })
      )
      .default({}),
    tools: toolRecord.default({}),
    version: z.literal(1),
    views: viewRecord.default({}),
  })
  .superRefine((schema, ctx) => {
    for (const [name, slot] of Object.entries(schema.slots)) {
      for (const [index, view] of slot.views.entries()) {
        if (!Object.hasOwn(schema.views, view)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown view "${view}".`,
            path: ["slots", name, "views", index],
          });
        }
      }
    }
  });

export type TailorKitSchemaSpec = z.infer<typeof TailorKitSchemaSpecSchema>;

export { TailorKitSchemaSpecSchema as TailorKitSchemaSpec };
