import { defineView } from "patchsmith/client";
import { useEffect, useState } from "preact/hooks";

import { Box, Button, Flex, Input, tools } from "#patchsmith";

import { PressablePrototype } from "./pressable-prototype";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Todo request failed";

const TodoPanel = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [err2, setErr2] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler cannot lower try/finally; preserve cleanup after failed requests.
      try {
        await (async () => {
          try {
            await (async () => {
              const result = await tools.todos.list();

              if (active) {
                setTodos(result);
              }
            })();
          } catch (error) {
            if (active) {
              setErr2(errorMessage(error));
            }
          }
        })();
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const addTodo = async () => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle || loading || pending) {
      return;
    }

    setPending(true);
    setErr2(null);

    try {
      const todo = await tools.todos.add({ title: trimmedTitle });
      setTodos((current) => [...current, todo]);
      setTitle("");
    } catch (error) {
      setErr2(errorMessage(error));
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler does not support try/finally; cleanup must also run after failures.
    } finally {
      setPending(false);
    }
  };

  const toggleTodo = async (todo: Todo) => {
    if (pending) {
      return;
    }

    setPending(true);
    setErr2(null);

    try {
      const updated = await tools.todos.toggle({ id: todo.id });
      setTodos((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch (error) {
      setErr2(errorMessage(error));
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler does not support try/finally; cleanup must also run after failures.
    } finally {
      setPending(false);
    }
  };

  const removeTodo = async (todo: Todo) => {
    if (pending) {
      return;
    }

    setPending(true);
    setErr2(null);

    try {
      await tools.todos.remove({ id: todo.id });
      setTodos((current) => current.filter((item) => item.id !== todo.id));
    } catch (error) {
      setErr2(errorMessage(error));
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler does not support try/finally; cleanup must also run after failures.
    } finally {
      setPending(false);
    }
  };

  return (
    <Box padding="md" width="full">
      <Flex direction="column" gap="lg">
        <Flex direction="column" gap="xs">
          <Box>Quick todos</Box>
          <Box textColor="muted">
            A small team checklist for the current workspace.
          </Box>
        </Flex>

        <Flex align="center" gap="sm">
          <Input
            onValueChange={({ value }) => {
              setTitle(value);
            }}
            placeholder="Add a task"
            value={title}
          />
          <Button
            disabled={loading || !title.trim() || pending}
            onClick={() => {
              void (async () => {
                await addTodo();
              })();
            }}
          >
            Add
          </Button>
        </Flex>

        {err2 !== undefined && err2 !== null && err2 !== "" ? (
          <Box textColor="muted">{err2}</Box>
        ) : null}
        {loading ? <Box textColor="muted">Loading todos…</Box> : null}
        {!loading && todos.length === 0 ? (
          <Box textColor="muted">No todos yet.</Box>
        ) : null}

        <Flex direction="column" gap="sm">
          {todos.map((todo) => (
            <Flex align="center" gap="sm" key={todo.id}>
              <Box grow="1">{todo.done ? `✓ ${todo.title}` : todo.title}</Box>
              <Button
                disabled={pending}
                onClick={() => {
                  void (async () => {
                    await toggleTodo(todo);
                  })();
                }}
                variant="secondary"
              >
                {todo.done ? "Reopen" : "Done"}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  void (async () => {
                    await removeTodo(todo);
                  })();
                }}
                variant="ghost"
              >
                Remove
              </Button>
            </Flex>
          ))}
        </Flex>
        <PressablePrototype />
      </Flex>
    </Box>
  );
};

const view = defineView({ component: TodoPanel, slot: "panel", view: "/" });

export default view;
