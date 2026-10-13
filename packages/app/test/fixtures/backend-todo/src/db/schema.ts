import { boolean, table, text } from "tailorkit/server";

export const todos = table("todos", {
  done: boolean().notNull().default(false),
  id: text().primaryKey(),
  text: text().notNull(),
});
