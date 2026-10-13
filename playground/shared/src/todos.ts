import { and, asc, eq } from "drizzle-orm";

import { db, todos } from "./db";

export type Todo = typeof todos.$inferSelect;

export const listTodos = (teamId: string) =>
  db
    .select()
    .from(todos)
    .where(eq(todos.teamId, teamId))
    .orderBy(asc(todos.createdAt))
    .all();

export const addTodo = (teamId: string, title: string): Todo => {
  const todo = {
    createdAt: new Date(),
    done: false,
    id: crypto.randomUUID(),
    teamId,
    title,
  };
  db.insert(todos).values(todo).run();
  return todo;
};

export const toggleTodo = (teamId: string, id: string): Todo | undefined => {
  const todo = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!todo || todo.teamId !== teamId) {
    return undefined;
  }
  const updated = { ...todo, done: !todo.done };
  db.update(todos).set({ done: updated.done }).where(eq(todos.id, id)).run();
  return updated;
};

export const removeTodo = (teamId: string, id: string): boolean => {
  const result = db
    .delete(todos)
    .where(and(eq(todos.teamId, teamId), eq(todos.id, id)))
    .run();
  return result.changes > 0;
};
