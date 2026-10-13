import { contract } from "@playground/shared/contracts/active";
import { theme } from "@playground/shared/contracts/theme";
import { Button } from "@tailorkit/ui/button";
import { Input } from "@tailorkit/ui/input";
import { createClient, primitives as reactPrimitives } from "tailorkit/react";

const callTodos = async <T,>(
  action: string,
  body?: Record<string, unknown>
): Promise<T> => {
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
};

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

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
        onChange={(event) => onValueChange({ value: event.target.value })}
        {...rest}
      />
    ),
  },
  contract,
  theme,
  tools: {
    todos: {
      add: ({ input }) => callTodos<Todo>("add", input),
      list: () => callTodos<Todo[]>("list"),
      remove: ({ input }) => callTodos<{ ok: boolean }>("remove", input),
      toggle: ({ input }) => callTodos<Todo>("toggle", input),
    },
  },
});

export const {
  Provider: TailorKitProvider,
  RenderSlot,
  useApps,
  useViewContext,
} = tailor;
