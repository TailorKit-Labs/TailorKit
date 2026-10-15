# SQLite and relational queries

Drizzle powers TailorKit's database internally. App code gets a restricted synchronous `db` capability inside queries and mutations, not an unrestricted Drizzle connection. Do not create a driver, open SQLite files, use D1/Postgres clients, or reach into Durable Object storage.

Keep the scaffold's three database files:

```ts
// src/db/schema.ts
import { table, text, boolean } from "tailorkit/server";

export const todos = table("todos", {
  id: text().primaryKey(),
  title: text().notNull(),
  done: boolean().notNull().default(false),
});

// src/db/relations.ts
import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema);

// src/db/index.ts
import { defineDatabase } from "tailorkit/server";

import { relations } from "./relations";

export const db = defineDatabase({ relations });
```

Import column builders (`table`, `text`, `integer`, `real`, `boolean`) and supported filter/order helpers from `tailorkit/server`. `boolean()` stores SQLite integers. Generate IDs in mutations, for example with `crypto.randomUUID()`; a text primary key has no automatic ID. Use explicit nullability/defaults and foreign-key references where enforcement is required. Table names must start with a letter, contain only letters/digits/underscores, be at most 63 characters, and avoid `sqlite_` and `tailorkit_` prefixes.

The scaffold uses Drizzle's `defineRelations` API, not the older `relations(table, ...)` API. Include all tables, even those without relationships. To link tables:

```ts
// src/db/relations.ts
import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  posts: {
    author: r.one.users({ from: r.posts.authorId, to: r.users.id }),
  },
  users: {
    posts: r.many.posts({ from: r.users.id, to: r.posts.authorId }),
  },
}));
```

`one`/`many` describe navigation and result shape; they do not create foreign-key constraints. Declare both navigation directions when needed, with columns that actually match. Follow the installed types for optional relations and multiple links between the same tables.

Attach the exported definition with `fn.query.database(db)` or `fn.mutation.database(db)`. Prefer relational reads when fetching entities and their relationships:

```ts
db.query.users
  .findMany({
    where: { id: input.userId },
    columns: { id: true },
    with: { posts: true },
  })
  .sync();
```

Use `findFirst(...).sync()` for an optional single row and handle absence. Filter, order, and limit on the server; select only columns and relations the UI needs. Relational reads avoid per-row query loops and remain part of reactive read tracking. Use `db.select().from(table).where(...).all()` or `.get()` for projections, joins, and aggregates that fit the select builder better.

Queries expose only `select`, `selectDistinct`, and `query`. Mutations add `insert`, `update`, and `delete`; execute writes with `.run()` or execute `.returning(...)` with `.all()`/`.get()`. Scope updates and deletes with `where`. Raw SQL execution, connection access, explicit transactions, and schema changes are outside the runtime capability; the mutation already owns its transaction. Never return an unexecuted builder or promise.

For schema changes, enable `server: {}`, then run `pnpm run db:generate` (`tailorkit db generate` delegates to Drizzle Kit with SQLite and `src/db/schema.ts`). Keep the generated SQL and snapshots under `src/db/migrations/`, or the configured `server.migrations` directory. Inspect generated changes for data loss; generate migrations rather than hand-writing SQL unless necessary. Preserve applied history and append new migrations. The build checks schema drift, bundles migrations, and the runtime applies them before database handlers run; do not push schema directly to a live database.
