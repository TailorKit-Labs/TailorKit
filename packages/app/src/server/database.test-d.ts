import {
  defineDatabase,
  defineRelations,
  table,
  text,
  boolean,
} from "@patchsmith/app-db";
import { z } from "zod";

import type { Client } from "#client/connection";
import { createApi } from "#client/reference";
import {
  createFunctions,
  query,
  mutation,
  defineRouter,
  defineServer,
} from "#server";

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
const appFn = createFunctions({ database });
const read = appFn.query
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
const write = appFn.mutation
  .input(z.string())
  .output(z.boolean())
  .handler(({ db, input }) => {
    db.insert(posts).values({ id: input, published: true, userId: "u1" }).run();
    return (
      db.query.posts.findFirst({ where: { id: input } }).sync()?.published ??
      false
    );
  });
const directQuery = appFn.query.handler(({ db }) =>
  db.query.users.findMany({ with: { posts: true } }).sync()
);
const directMutation = appFn.mutation.handler(({ db }) =>
  db.query.posts.findFirst().sync()
);
// @ts-expect-error Per-function database binding has been removed.
void appFn.query.database;
// @ts-expect-error Mutations use the shared database binding too.
void appFn.mutation.database;
// @ts-expect-error Actions have no database configuration.
void appFn.action.database;
query({
  args: z.undefined(),
  // @ts-expect-error Configure database relations through createFunctions instead.
  database,
  handler: () => null,
});
mutation({
  args: z.undefined(),
  // @ts-expect-error Configure database relations through createFunctions instead.
  database,
  handler: () => null,
});
// @ts-expect-error A query cannot return a relational promise; use sync().
appFn.query.handler(({ db }) => db.query.users.findMany());
const router = defineRouter({ directMutation, directQuery, read, write });
const app = defineServer(router);
const nestedApp = defineServer({ users: router });
const nestedApi = createApi<typeof nestedApp.functions>();
appFn.action.handler((context) => {
  // @ts-expect-error Shared database configuration does not give actions a database handle.
  void context.db;
  return null;
});
const run = appFn.action
  .functions({ users: router })
  .handler(async ({ queries }) => await queries.users.read({ id: "u1" }));
void run;
const api = createApi<typeof app.functions>();
declare const client: Client;
void (client.query(nestedApi.users.read, { id: "u1" }) satisfies Promise<
  { id: string; posts: { id: string; userId: string; published: boolean }[] }[]
>);
// @ts-expect-error Router composition preserves argument types.
void client.query(nestedApi.users.read, { id: 1 });
void (client.query(api.read, { id: "u1" }) satisfies Promise<
  { id: string; posts: { id: string; userId: string; published: boolean }[] }[]
>);
void (client.mutate(api.write, "p1") satisfies Promise<boolean>);
