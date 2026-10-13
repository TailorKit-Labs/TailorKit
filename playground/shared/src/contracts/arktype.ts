import { tool, defineContract } from "tailorkit";
import { primitives } from "tailorkit/arktype";
import { type } from "arktype";
import { theme } from "./theme";

const todo = type({ id: "string", title: "string", done: "boolean" });

export const contract = defineContract({
  components: {
    ...primitives(theme),
    Button: {
      fields: type({
        "disabled?": "boolean",
        "size?": "'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'",
        "variant?": "'default' | 'secondary' | 'ghost' | 'outline' | 'destructive'",
      }),
      callbacks: { onClick: {} },
      children: true,
    },
    Input: {
      fields: type({ value: "string", "placeholder?": "string" }),
      callbacks: { onValueChange: { input: type({ value: "string" }) } },
    },
  },
  views: {
    "/": type({ user: { id: "string", name: "string" }, team: { id: "string", name: "string" } }),
  },
  slots: { panel: { views: ["/"] } },
  scopes: {
    user: type({ userId: "string > 0" }),
    team: type({ teamId: "string > 0" }),
  },
  tools: {
    todos: {
      list: tool.client().output(todo.array()),
      add: tool
        .client()
        .input(type({ title: "string > 0 <= 160" }))
        .output(todo),
      toggle: tool
        .client()
        .input(type({ id: "string" }))
        .output(todo),
      remove: tool
        .client()
        .input(type({ id: "string" }))
        .output(type({ ok: "boolean" })),
    },
  },
});
