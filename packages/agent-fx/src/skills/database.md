# Installation SQLite, schemas, and migrations

## Storage model

Each app installation has its own persistent SQLite database in the managed Cloudflare Durable Object runtime. App releases and backend code replacement use that installation's storage; they do not create a fresh database. Client Preact state and module globals are temporary. Host-owned records remain behind the host's tools and context.

App functions receive restricted Drizzle capabilities. Queries can read; mutations can read and write. There is no raw SQLite connection, filesystem database, D1 binding, Postgres service, or unrestricted transaction handle to configure. Use actions to coordinate external work with queries/mutations; the functions skill covers those boundaries.

## Define tables and relations

Follow an existing app's database organization. The default scaffold separates `src/db/schema.ts`, `src/db/relations.ts`, and `src/db/index.ts`:

```ts
// src/db/schema.ts
import { table, text, boolean } from "tailorkit/server";

export const notes = table("notes", {
  id: text().primaryKey(),
  title: text().notNull(),
  archived: boolean().notNull().default(false),
});
```

```ts
// src/db/relations.ts
import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema);
```

```ts
// src/db/index.ts
import { defineDatabase } from "tailorkit/server";

import { relations } from "./relations";

export const db = defineDatabase({ relations });
```

Use `table`, `text`, `integer`, `real`, and `boolean` from `tailorkit/server`. Boolean columns use SQLite integer storage; text primary keys need explicit IDs, for example `crypto.randomUUID()` in a mutation. Choose nullability, defaults, and references deliberately. Table names start with a letter, contain letters/digits/underscores, have at most 63 characters, and cannot start with the reserved `sqlite_` or `tailorkit_` prefixes.

Use Drizzle's `defineRelations` API with all schema tables, including tables without relationships. For relationships, define navigation using the actual local/remote columns, for example `author: r.one.users({ from: r.notes.authorId, to: r.users.id })` and the reverse `r.many.notes()`. A relation describes query navigation; it does not create a foreign-key constraint. Declare the reference on the column when enforcement is required. Follow the installed Drizzle version for relation details rather than using an older `relations(table, ...)` recipe.

## Read and write through function capabilities

Attach the exported definition using `.database(database)` on `fn.query` or `fn.mutation`. Prefer bounded relational reads when loading related records:

```ts
db.query.notes
  .findMany({
    columns: { id: true, title: true },
    where: { archived: false },
    limit: 50,
  })
  .sync();
```

Use `findFirst(...).sync()` for an optional record and handle absence. Use select builders with `.all()`/`.get()` for projections, joins, or aggregates, and execute mutation writes with `.run()` or `.returning(...).all()`/`.get()`. Import supported filters and ordering helpers from `tailorkit/server`. Do not return a builder or await database execution inside a synchronous handler.

Filter and paginate on the backend; return the fields the UI needs rather than the whole database or one query per list item. Scope updates/deletes with conditions. A mutation is already atomic, and its handle is revoked when it returns. Raw SQL execution and ad hoc schema changes are not app runtime capabilities; schema changes belong in migrations.

The installation may be shared by multiple users and views. For private or record-scoped data, store appropriate ownership/context identifiers and enforce them against trusted identity or authorized context in every read and write. Do not trust a supplied userId or record ID merely because it is well-formed. Missing or inaccessible records should produce a safe, explicit result or app error.

## Generate migrations

Enable `server: {}` before adding database functionality. After changing schema definitions, run the app's `db:generate` script or its package-manager equivalent of `tailorkit db generate`. The CLI uses Drizzle Kit for SQLite. Defaults are `src/db/schema.ts` and `src/db/migrations`; a configured `server.migrations` directory overrides the migration location.

Inspect generated SQL and schema snapshots. Confirm additions, defaults, foreign keys and rename intent. Avoid a drop/recreate when the request is a rename. For populated tables, plan how existing rows receive new required values. Keep generated SQL and snapshots together with the app source. Preserve every applied migration's order and contents; append new migrations instead of rewriting or deleting history.

The TailorKit build checks schema drift and bundles migrations into the private backend. Deployment publishes that bundle. On backend initialization, the runtime checks the migration history and applies pending migrations transactionally before serving database functions. A failed upgrade does not count as a successful schema deployment. The agent should not connect to a live database or run a schema-push command to bypass this path.

Treat upgrades as changes to existing installation data. Prefer additive changes, make destructive changes only when requested and understood, and test migration effects on representative old data when practical. A rollback to older app code does not automatically reverse SQLite migrations; preserve compatibility with data already written. Resolve build-time drift or incompatible-history errors by correcting source and generating a forward migration, not disabling validation or resetting the installation's database.
