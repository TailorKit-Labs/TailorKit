import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { tool, defineContract } from "tailorkit";
import { primitives } from "tailorkit/valibot";
import * as v from "valibot";
import { theme } from "./theme";

const todo = v.object({
  id: v.string(),
  title: v.string(),
  done: v.boolean(),
});
const json = <TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
) => toStandardJsonSchema(schema);
const primitiveComponents = Object.fromEntries(
  Object.entries(primitives(theme)).map(([name, component]) => [
    name,
    {
      ...component,
      fields: json(component.fields as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>),
    },
  ]),
);

export const contract = defineContract({
  components: {
    ...primitiveComponents,
    Button: {
      fields: json(
        v.object({
          disabled: v.optional(v.boolean()),
          size: v.optional(v.picklist(["default", "sm", "lg", "icon", "icon-sm"])),
          variant: v.optional(
            v.picklist(["default", "secondary", "ghost", "outline", "destructive"]),
          ),
        }),
      ),
      callbacks: { onClick: {} },
      children: true,
    },
    Input: {
      fields: json(v.object({ value: v.string(), placeholder: v.optional(v.string()) })),
      callbacks: { onValueChange: { input: json(v.object({ value: v.string() })) } },
    },
  },
  views: {
    "/": json(
      v.object({
        user: v.object({ id: v.string(), name: v.string() }),
        team: v.object({ id: v.string(), name: v.string() }),
      }),
    ),
  },
  slots: { panel: { views: ["/"] } },
  scopes: {
    user: json(v.object({ userId: v.pipe(v.string(), v.minLength(1)) })),
    team: json(v.object({ teamId: v.pipe(v.string(), v.minLength(1)) })),
  },
  tools: {
    todos: {
      list: tool.client().output(json(v.array(todo))),
      add: tool
        .client()
        .input(json(v.object({ title: v.pipe(v.string(), v.minLength(1), v.maxLength(160)) })))
        .output(json(todo)),
      toggle: tool
        .client()
        .input(json(v.object({ id: v.string() })))
        .output(json(todo)),
      remove: tool
        .client()
        .input(json(v.object({ id: v.string() })))
        .output(json(v.object({ ok: v.boolean() }))),
    },
  },
});
