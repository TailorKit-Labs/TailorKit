import { type } from "arktype";
import { tool, defineContract } from "tailorkit";
import { primitives } from "tailorkit/arktype";

import { theme } from "./theme";

const todo = type({ done: "boolean", id: "string", title: "string" });

export const contract = defineContract({
  components: {
    ...primitives(theme),
    Button: {
      callbacks: { onClick: {} },
      children: true,
      fields: type({
        "disabled?": "boolean",
        "size?": "'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'",
        "variant?":
          "'default' | 'secondary' | 'ghost' | 'outline' | 'destructive'",
      }),
    },
    Input: {
      callbacks: { onValueChange: { input: type({ value: "string" }) } },
      fields: type({ "placeholder?": "string", value: "string" }),
    },
  },
  scopes: {
    team: type({ teamId: "string > 0" }),
    user: type({ userId: "string > 0" }),
  },
  slots: { panel: { views: ["/"] } },
  tools: {
    todos: {
      add: tool
        .client()
        .input(type({ title: "0 < string <= 160" }))
        .output(todo),
      list: tool.client().output(todo.array()),
      remove: tool
        .client()
        .input(type({ id: "string" }))
        .output(type({ ok: "boolean" })),
      toggle: tool
        .client()
        .input(type({ id: "string" }))
        .output(todo),
    },
  },
  views: {
    "/": type({
      team: { id: "string", name: "string" },
      user: { id: "string", name: "string" },
    }),
  },
});
