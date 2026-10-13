import { defineRelations } from "drizzle-orm";
import { z } from "zod";

import type { Client } from "../client/connection";
import { createApi } from "../client/reference";
import {
  defineDatabase,
  table,
  text,
  boolean,
  fn,
  query,
  mutation,
  defineServer,
} from "../server";

const users = table("users", { id: text().primaryKey() });
const posts = table("posts", {
  id: text().primaryKey(),
  published: boolean().notNull(),
  userId: text().notNull(),
});
const relations = defineRelations({ posts, users }, (r) => ({
  posts: { user: r.one.users({ from: r.posts.userId, to: r.users.id }) },
  users: { posts: r.many.posts({ from: r.users.id, to: r.posts.userId }) },
}));
const database = defineDatabase({ relations });
const read = fn.query
  .database(database)
  .input(z.object({ id: z.string() }))
  .handler(({ db, input }) => {
    // @ts-expect-error Queries cannot write even with relations configured.
    void db.insert;
    // @ts-expect-error Unknown tables are rejected.
    void db.query.missing;
    const rows = db.query.users
      .findMany({ where: { id: input.id }, with: { posts: true } })
      .sync();
    rows satisfies {
      id: string;
      posts: { id: string; userId: string; published: boolean }[];
    }[];
    // @ts-expect-error Relation columns retain their types.
    rows satisfies { id: number }[];
    return rows;
  });
const write = fn.mutation
  .input(z.string())
  .database(database)
  .output(z.boolean())
  .handler(({ db, input }) => {
    db.insert(posts).values({ id: input, published: true, userId: "u1" }).run();
    return (
      db.query.posts.findFirst({ where: { id: input } }).sync()?.published ??
      false
    );
  });
const directQuery = query({
  args: z.undefined(),
  database,
  handler: ({ db }) =>
    db.query.users.findMany({ with: { posts: true } }).sync(),
});
const directMutation = mutation({
  args: z.undefined(),
  database,
  handler: ({ db }) => db.query.posts.findFirst().sync(),
});
// @ts-expect-error Actions cannot access a database directly.
fn.action.database(database);
// @ts-expect-error A query cannot return a relational promise; use sync().
fn.query.database(database).handler(({ db }) => db.query.users.findMany());
const app = defineServer({ directMutation, directQuery, read, write });
const api = createApi<typeof app.functions>();
declare const client: Client;
client.query(api.read, { id: "u1" }) satisfies Promise<
  { id: string; posts: { id: string; userId: string; published: boolean }[] }[]
>;
client.mutate(api.write, "p1") satisfies Promise<boolean>;
