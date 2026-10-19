# PatchSmith app database

Use `patchsmith/db` for app database definitions, schema builders, relation helpers, query operators, and database types. This entry point is backed by the public `@patchsmith/app-db` package. The private `@patchsmith/db` workspace manages the platform's Postgres database separately.

```ts
import { defineDatabase, defineRelations, table, text } from "patchsmith/db";

const users = table("users", { id: text().primaryKey() });
const posts = table("posts", {
  id: text().primaryKey(),
  userId: text().notNull(),
});

const relations = defineRelations({ posts, users }, (r) => ({
  posts: { user: r.one.users({ from: r.posts.userId, to: r.users.id }) },
  users: { posts: r.many.posts({ from: r.users.id, to: r.posts.userId }) },
}));

export const database = defineDatabase({ relations });
```

`defineRelations(schema)` includes all tables without navigation. Its optional callback adds typed one/many navigation; foreign-key constraints belong on schema columns. PatchSmith adapts the relation definitions to Drizzle internally.

Bind the definition once in your shared database module:

```ts
import { createFunctions } from "patchsmith/server";

export const fn = createFunctions({ database });
```

Function modules import this shared `fn` and use `fn.query.handler(({ db }) => ...)` or `fn.mutation.handler(({ db }) => ...)`. The runtime supplies the scoped database handle; the shared builder supplies table and relation types. Queries receive read capabilities; mutations also receive write capabilities. Execution remains synchronous inside the managed installation runtime.

Existing apps should move database imports from `patchsmith/server` to `patchsmith/db`, and import `defineRelations` from `patchsmith/db` instead of `drizzle-orm`. Existing relation callbacks keep their syntax.
