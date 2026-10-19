# Store app data

Each installation, an installed copy of the app, has persistent SQLite shared by its users. Use it for data the app owns. Backend functions enforce who can read or change that data; TailorKit manages the connection and transactions.

Import table builders, `defineRelations`, `defineDatabase`, and query helpers from `tailorkit/db`. Keep these imports in backend files.

## Tables and columns

Define tables in `src/db/schema.ts` with `table`, `text`, `integer`, `real`, and `boolean`. Use `crypto.randomUUID()` for text IDs. Table names start with a letter, contain letters/digits/underscores, have at most 63 characters, and avoid `sqlite_` and `tailorkit_` prefixes.

For example, define installation-shared notes in `src/db/schema.ts`:

<!-- example: src/db/schema.ts -->

```ts
import { table, text } from "tailorkit/db";

export const notes = table("notes", {
  id: text().primaryKey(),
  title: text().notNull(),
});
```

Set required fields and defaults for the feature. `.$type<T>()` narrows TypeScript values; validate function input at runtime too. `typeof notes.$inferInsert` gives the insert row type. Create and insert rows inside mutations.

## Relations and queries

In `src/db/index.ts`, include the tables and bind the function builder:

<!-- example: src/db/index.ts -->

```ts
import { defineDatabase, defineRelations } from "tailorkit/db";
import { createFunctions } from "tailorkit/server";

import * as schema from "./schema";

export const db = defineDatabase({ relations: defineRelations(schema) });
export const fn = createFunctions({ database: db });
```

Function modules import `fn` from `#db`. Run relational reads with `.sync()`, select builders with `.all()`/`.get()`, and writes with `.run()` or `.returning(...).all()`/`.get()`. Filter by access rules, select needed fields, and limit growing lists. A mutation already runs in a transaction.

Relations describe connected records. Add a `defineRelations` callback when needed: `r.one.users({ from: r.notes.authorId, to: r.users.id })`. A column reference defines a foreign-key constraint.

## Schema changes

Run `pnpm run db:generate` after table changes. Keep the generated SQL and snapshots, normally under `src/db/migrations`. Add forward migrations; preserve applied history and existing data. New required columns need defaults or a backfill for existing rows.

The build detects missing migrations; deployment applies pending migrations before database functions run. Correct the definitions and add a migration for upgrades. Use this migration path rather than schema push, runtime SQL, or database resets.
