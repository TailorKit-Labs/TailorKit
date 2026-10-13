import { contract } from "@playground/shared/contracts/active";
import { theme } from "@playground/shared/contracts/theme";
import { Button } from "@tailorkit/ui/button";
import { Input } from "@tailorkit/ui/input";
import { createClient, primitives as reactPrimitives } from "tailorkit/react";
import { z } from "zod";

const isObjectValue = <TValue,>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const callTodos = async <TSchema extends z.ZodType>(
  action: string,
  schema: TSchema,
  body?: { id?: string; title?: string }
): Promise<z.output<TSchema>> => {
  const response = await fetch("/api/playground/todos", {
    body: body ? JSON.stringify({ action, ...body }) : undefined,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: body ? "POST" : "GET",
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isObjectValue(result) && result !== null && "error" in result
        ? String(result.error)
        : "Todo request failed";
    throw new Error(message);
  }
  return schema.parse(result);
};

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

export const tailor = createClient({
  baseUrl:
    typeof window === "undefined"
      ? "http://localhost:5010/api/tailorkit/"
      : new URL("/api/tailorkit/", window.location.origin),
  components: {
    ...reactPrimitives,
    Button: ({ props, children }) => <Button {...props}>{children}</Button>,
    Input: ({ props: { onValueChange, ...rest } }) => (
      <Input
        onChange={(event) => {
          onValueChange({ value: event.target.value });
        }}
        {...rest}
      />
    ),
  },
  contract,
  theme,
  tools: {
    todos: {
      add: async ({ input }) => await callTodos("add", todoSchema, input),
      list: async () => await callTodos("list", z.array(todoSchema)),
      remove: async ({ input }) =>
        await callTodos("remove", z.object({ ok: z.boolean() }), input),
      toggle: async ({ input }) => await callTodos("toggle", todoSchema, input),
    },
  },
});

export const {
  Provider: TailorKitProvider,
  RenderSlot,
  useApps,
  useViewContext,
} = tailor;
