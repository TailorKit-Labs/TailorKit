import { openapi } from "@orpc/openapi";
import { type } from "@orpc/server";

import { o } from "#server/procedures";
import type { PatchsmithSchemaSpec } from "#spec/index";

export const schema = o
  .meta(openapi({ method: "GET", path: "/schema" }))
  .output(type<PatchsmithSchemaSpec>())
  .handler(({ context }): PatchsmithSchemaSpec =>
    context.schema.serialize(context.schemaSerializer)
  );

export const meta = o
  .meta(openapi({ method: "GET", path: "/meta" }))
  .output(type<{ schema: PatchsmithSchemaSpec }>())
  .handler(({ context }) => ({
    schema: context.schema.serialize(context.schemaSerializer),
  }));
