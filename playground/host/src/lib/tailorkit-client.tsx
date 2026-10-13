import { Button } from "@tailorkit/ui/button";
import { Input } from "@tailorkit/ui/input";
import { createClient, primitives as reactPrimitives } from "tailorkit/react";
import { contract } from "@playground/shared/contracts/active";
import { theme } from "@playground/shared/contracts/theme";

async function callTodos<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/playground/todos", {
    body: body ? JSON.stringify({ action, ...body }) : undefined,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: body ? "POST" : "GET",
  });
  const result = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      typeof result === "object" && result !== null && "error" in result
        ? String(result.error)
        : "Todo request failed";
    throw new Error(message);
  }
  return result as T;
}

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

export const tailor = createClient({
  contract,
  baseUrl:
    typeof window === "undefined"
      ? "http://localhost:5010/api/tailorkit/"
      : new URL("/api/tailorkit/", window.location.origin),
  theme,
  components: {
    ...reactPrimitives,
    Button: ({ props, children }) => <Button {...props}>{children}</Button>,
    Input: ({ props: { onValueChange, ...rest } }) => (
      <Input onChange={(event) => onValueChange({ value: event.target.value })} {...rest} />
    ),
  },
  tools: {
    todos: {
      list: () => callTodos<Todo[]>("list"),
      add: ({ input }) => callTodos<Todo>("add", input),
      toggle: ({ input }) => callTodos<Todo>("toggle", input),
      remove: ({ input }) => callTodos<{ ok: boolean }>("remove", input),
    },
  },
});

export const { Provider: TailorKitProvider, RenderSlot, useApps, useViewContext } = tailor;
