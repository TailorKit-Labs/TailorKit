import { defineView } from "tailorkit/client";
import { useState } from "preact/hooks";
import { Box, Button, Flex, Input } from "#tailorkit";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

const view = defineView({ slot: "panel", view: "/", component: TodoPanel });

function TodoPanel() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: "todo-1", title: "Review the onboarding flow", done: false },
    { id: "todo-2", title: "Share this playground with the team", done: true },
  ]);
  const [title, setTitle] = useState("");

  function addTodo() {
    if (!title.trim()) return;
    setTodos((current) => [
      ...current,
      { id: crypto.randomUUID(), title: title.trim(), done: false },
    ]);
    setTitle("");
  }

  function toggleTodo(todo: Todo) {
    setTodos((current) =>
      current.map((item) => (item.id === todo.id ? { ...item, done: !item.done } : item)),
    );
  }

  function removeTodo(todo: Todo) {
    setTodos((current) => current.filter((item) => item.id !== todo.id));
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
          <Button disabled={!title.trim()} onClick={addTodo}>
            Add
          </Button>
        </Flex>

        {todos.length === 0 ? <Box textColor="muted">No todos yet.</Box> : null}

        <Flex direction="column" gap="sm">
          {todos.map((todo) => (
            <Flex align="center" gap="sm" key={todo.id}>
              <Box grow="1">{todo.done ? `✓ ${todo.title}` : todo.title}</Box>
              <Button onClick={() => toggleTodo(todo)} variant="secondary">
                {todo.done ? "Reopen" : "Done"}
              </Button>
              <Button onClick={() => removeTodo(todo)} variant="ghost">
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
