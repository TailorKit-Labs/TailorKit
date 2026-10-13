import { addTodo, listTodos, removeTodo, toggleTodo } from "@playground/shared/todos";
import { getDemoSessionFromRequest } from "@playground/shared/auth";
import { createFileRoute } from "@tanstack/react-router";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function handle({ request }: { request: Request }) {
  const session = getDemoSessionFromRequest(request);
  if (!session) return json({ error: "Sign in to use the todo app" }, 401);

  if (request.method === "GET") {
    return json(listTodos(session.team.id).map(({ id, title, done }) => ({ id, title, done })));
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    title?: string;
    id?: string;
  } | null;

  if (body?.action === "add" && typeof body.title === "string") {
    const title = body.title.trim();
    if (!title || title.length > 160) return json({ error: "Use 1 to 160 characters" }, 400);
    const todo = addTodo(session.team.id, title);
    return json({ id: todo.id, title: todo.title, done: todo.done });
  }

  if (body?.action === "toggle" && typeof body.id === "string") {
    const todo = toggleTodo(session.team.id, body.id);
    return todo
      ? json({ id: todo.id, title: todo.title, done: todo.done })
      : json({ error: "Todo not found" }, 404);
  }

  if (body?.action === "remove" && typeof body.id === "string") {
    return removeTodo(session.team.id, body.id)
      ? json({ ok: true })
      : json({ error: "Todo not found" }, 404);
  }

  return json({ error: "Invalid todo action" }, 400);
}

export const Route = createFileRoute("/api/playground/todos")({
  server: { handlers: { GET: handle, POST: handle } },
});
