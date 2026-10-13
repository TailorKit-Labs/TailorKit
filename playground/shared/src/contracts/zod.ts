import { tool, defineContract } from "tailorkit";
import { primitives } from "tailorkit/zod";
import { z } from "zod";
import { theme } from "./theme";

const todo = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

export const contract = defineContract({
  components: {
    ...primitives(theme),
    Button: {
      fields: z.object({
        disabled: z.boolean().optional(),
        size: z.enum(["default", "sm", "lg", "icon", "icon-sm"]).optional(),
        variant: z.enum(["default", "secondary", "ghost", "outline", "destructive"]).optional(),
      }),
      callbacks: { onClick: {} },
      children: true,
    },
    Input: {
      fields: z.object({
        value: z.string(),
        placeholder: z.string().optional(),
      }),
      callbacks: { onValueChange: { input: z.object({ value: z.string() }) } },
    },
  },
  views: {
    "/": z.object({
      user: z.object({ id: z.string(), name: z.string() }),
      team: z.object({ id: z.string(), name: z.string() }),
    }),
  },
  slots: { panel: { views: ["/"] } },
  scopes: {
    user: z.object({ userId: z.string().min(1) }),
    team: z.object({ teamId: z.string().min(1) }),
  },
  tools: {
    todos: {
      list: tool.client().output(z.array(todo)),
      add: tool
        .client()
        .input(z.object({ title: z.string().min(1).max(160) }))
        .output(todo),
      toggle: tool
        .client()
        .input(z.object({ id: z.string() }))
        .output(todo),
      remove: tool
        .client()
        .input(z.object({ id: z.string() }))
        .output(z.object({ ok: z.boolean() })),
    },
  },
});
