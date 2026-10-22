import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Disposable backend for worker database, action and tool integration tests. */
export const createTestBackend = async (root: string): Promise<void> => {
  await mkdir(path.join(root, "db"), { recursive: true });
  await symlink(
    path.resolve(import.meta.dirname, "../../node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "db/schema.ts"),
    `import { boolean, table, text } from "@patchsmith/app-db";
export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
});
`
  );
  await writeFile(
    path.join(root, "functions.ts"),
    `import { AppError, createFunctions, defineRouter } from "@patchsmith/app/server";
import { defineDatabase, defineRelations } from "@patchsmith/app-db";
import { z } from "zod";
import * as schema from "./db/schema";

const database = defineDatabase({ relations: defineRelations(schema) });
const fn = createFunctions({ database });
const list = fn.query.handler(({ db }) =>
  db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 1000 }).sync()
);
const add = fn.mutation
  .input(z.object({ text: z.string().trim().min(1).max(500) }))
  .handler(({ db, input }) => {
    const todo = db.insert(schema.todos)
      .values({ id: crypto.randomUUID(), text: input.text, done: false })
      .returning().get();
    if (!todo) throw new AppError("INTERNAL_SERVER_ERROR", "Could not create todo");
    return todo;
  });
const privateTodos = defineRouter({
  list: fn.query.internal().handler(({ db }) =>
    db.query.todos.findMany({ limit: 1000 }).sync()
  ),
  add: fn.mutation.internal()
    .input(z.object({ text: z.string().trim().min(1).max(500) }))
    .handler(({ db, input }) => {
      const todo = db.insert(schema.todos)
        .values({ id: crypto.randomUUID(), text: input.text, done: false })
        .returning().get();
      if (!todo) throw new AppError("INTERNAL_SERVER_ERROR", "Could not create todo");
      return todo;
    }),
  run: fn.action.internal().handler(() => "private"),
});
const importTodo = fn.action.functions({ privateTodos })
  .input(z.object({ url: z.url() }))
  .handler(async ({ input, queries, mutations, tools, signal }) => {
    await queries.privateTodos.list();
    const response = await fetch(input.url, { signal });
    if (!response.ok) throw new AppError("UNAVAILABLE", "External API failed");
    const data = z.object({ title: z.string().trim().min(1).max(500) })
      .parse(await response.json());
    const text = await tools.echo(data.title);
    return mutations.privateTodos.add({ text });
  });
export default defineRouter({ list, add, importTodo, privateTodos });`
  );
};
