import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Disposable backend for worker database, action and tool integration tests. */
export async function createTestBackend(root: string): Promise<void> {
  await mkdir(path.join(root, "db"), { recursive: true });
  await symlink(
    path.resolve(import.meta.dirname, "../../node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "db/schema.ts"),
    `import { boolean, table, text } from "@tailorkit/app/server";
export const todos = table("todos", {
  id: text().primaryKey(),
  text: text().notNull(),
  done: boolean().notNull().default(false),
});
`,
  );
  await writeFile(
    path.join(root, "server.ts"),
    `import { AppError, defineDatabase, defineServer, fn } from "@tailorkit/app/server";
import { defineRelations } from "drizzle-orm";
import { z } from "zod";
import * as schema from "./db/schema";

const database = defineDatabase({ relations: defineRelations(schema) });
const list = fn.query.database(database).handler(({ db }) =>
  db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 1000 }).sync()
);
const add = fn.mutation.database(database)
  .input(z.object({ text: z.string().trim().min(1).max(500) }))
  .handler(({ db, input }) => {
    const todo = db.insert(schema.todos)
      .values({ id: crypto.randomUUID(), text: input.text, done: false })
      .returning().get();
    if (!todo) throw new AppError("INTERNAL_SERVER_ERROR", "Could not create todo");
    return todo;
  });
const importTodo = fn.action.functions({ list, add })
  .input(z.object({ url: z.url() }))
  .handler(async ({ input, queries, mutations, tools, signal }) => {
    await queries.list();
    const response = await fetch(input.url, { signal });
    if (!response.ok) throw new AppError("UNAVAILABLE", "External API failed");
    const data = z.object({ title: z.string().trim().min(1).max(500) })
      .parse(await response.json());
    const text = await tools.echo(data.title);
    return mutations.add({ text });
  });
export default defineServer({ list, add, importTodo });`,
  );
}
