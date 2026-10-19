# App SQLite

Each installation has persistent SQLite shared by its users. Use it only for app-owned data and enforce the feature's access rules in functions. Queries/mutations receive a restricted database capability; there is no driver or database service to configure.

Use `tailorkit/db` for table/column builders, `defineRelations`, `defineDatabase`, and query helpers. Keep database imports in backend modules. Follow the scaffold's `src/db/schema.ts`, `relations.ts`, and `index.ts`; the [function example](references/functions.md) shows them together.

## Columns and inserts

Use `table`, `text`, `integer`, `real`, and `boolean`. Choose required fields and defaults to match the feature; generate text IDs with `crypto.randomUUID()`. Table names start with a letter, contain letters/digits/underscores, are at most 63 characters, and avoid `sqlite_`/`tailorkit_` prefixes.

For a finite text type, `.$type<T>()` narrows TypeScript; validate inputs at runtime too. `$inferInsert` describes complete insert rows. For example:

<!-- example: typed-insert -->

```ts
import { integer, table, text } from "tailorkit/db";

export type Priority = "low" | "medium" | "high";
export const tasks = table("tasks", {
  id: text().primaryKey(),
  title: text().notNull(),
  priority: text().$type<Priority>().notNull().default("medium"),
  createdAt: integer().notNull(),
});

export type TaskInsert = typeof tasks.$inferInsert;
export const row: TaskInsert = {
  id: crypto.randomUUID(),
  title: "Review design",
  priority: "high",
  createdAt: Date.now(),
};
```

Insert the row inside a mutation. The table only needs the columns required by the feature.

## Relations and execution

Pass all tables to `defineRelations(schema)`, then `defineDatabase({ relations })`. Add a relation callback only when querying related records. `r.one.users({ from: r.notes.authorId, to: r.users.id })` defines navigation; a column reference defines a foreign-key constraint.

Attach the database with `.database(database)`. Relational reads end in `.sync()`, select builders in `.all()`/`.get()`, and writes in `.run()` or `.returning(...).all()`/`.get()`. Apply appropriate ownership conditions to reads/updates/deletes. Filter and limit in the query when needed. Mutations already provide a transaction; raw SQL/connection access and runtime schema changes are unavailable.

## Migrations

After schema changes, run `db:generate` (`tailorkit db generate`). Inspect the generated SQL and keep it with its snapshots under the configured migrations directory, normally `src/db/migrations`. Append migrations and preserve applied history. For existing data, ensure new required fields have suitable defaults or a backfill.

The build checks drift and bundles migrations; deployment applies pending migrations before database functions run. Correct source and generate a forward migration for upgrade failures. Preserve existing data; do not bypass this path with schema push or database resets.
