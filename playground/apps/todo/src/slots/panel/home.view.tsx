import { defineView } from "tailorkit/client";
import { useEffect, useState } from "preact/hooks";
import { Box, Button, Flex, Input, tools } from "#tailorkit";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

const view = defineView({ slot: "panel", view: "/", component: TodoPanel });

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Todo request failed";
}

function TodoPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void tools.todos
      .list()
      .then((result) => {
        if (active) setTodos(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function addTodo() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || loading || pending) return;

    setPending(true);
    setError(null);
    try {
      const todo = await tools.todos.add({ title: trimmedTitle });
      setTodos((current) => [...current, todo]);
      setTitle("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function toggleTodo(todo: Todo) {
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const updated = await tools.todos.toggle({ id: todo.id });
      setTodos((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function removeTodo(todo: Todo) {
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      await tools.todos.remove({ id: todo.id });
      setTodos((current) => current.filter((item) => item.id !== todo.id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Box padding="md" width="full">
      <Flex direction="column" gap="lg">
        <Flex direction="column" gap="xs">
          <Box>Quick todos</Box>
          <Box textColor="muted">A small team checklist for the current workspace.</Box>
        </Flex>

        <Flex align="center" gap="sm">
          <Input
            onValueChange={({ value }) => setTitle(value)}
            placeholder="Add a task"
            value={title}
          />
          <Button disabled={loading || !title.trim() || pending} onClick={() => void addTodo()}>
            Add
          </Button>
        </Flex>

        {error ? <Box textColor="muted">{error}</Box> : null}
        {loading ? <Box textColor="muted">Loading todos…</Box> : null}
        {!loading && todos.length === 0 ? <Box textColor="muted">No todos yet.</Box> : null}

        <Flex direction="column" gap="sm">
          {todos.map((todo) => (
            <Flex align="center" gap="sm" key={todo.id}>
              <Box grow="1">{todo.done ? `✓ ${todo.title}` : todo.title}</Box>
              <Button disabled={pending} onClick={() => void toggleTodo(todo)} variant="secondary">
                {todo.done ? "Reopen" : "Done"}
              </Button>
              <Button disabled={pending} onClick={() => void removeTodo(todo)} variant="ghost">
                Remove
              </Button>
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Box>
  );
}

export default view;
