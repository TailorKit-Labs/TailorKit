# Private records and external actions

Use this recipe for app-owned notes, tasks, saved filters, or settings that belong to an authenticated user. For records deliberately shared by an installation, define that access model explicitly. For product-owned records, use the generated tools instead of making a second database copy.

## Tables and registration

The examples form one app. Enable `server: {}`, generate migrations after adding the tables, then regenerate bindings after registration. Keep validators shared with the frontend in a separate module if both need them; database modules stay server-only.

<!-- example: src/db/schema.ts -->

```ts
import { boolean, integer, table, text } from "tailorkit/db";

export const notes = table("notes", {
  id: text().primaryKey(),
  ownerId: text().notNull(),
  title: text().notNull(),
  archived: boolean().notNull().default(false),
  createdAt: integer().notNull(),
});
```

<!-- example: src/db/relations.ts -->

```ts
import { defineRelations } from "tailorkit/db";

import * as schema from "./schema";

export const relations = defineRelations(schema);
```

<!-- example: src/db/index.ts -->

```ts
import { defineDatabase } from "tailorkit/db";

import { relations } from "./relations";

export const db = defineDatabase({ relations });
```

## Authorize every read and write

Derive ownership from verified identity; the caller never chooses `ownerId`. Both update and delete include ownership in the write condition. The list is bounded and returns only UI fields. Add pagination for larger collections and a revision check when concurrent edits must detect conflicts.

<!-- example: src/functions/notes.ts -->

```ts
import { and, eq } from "tailorkit/db";
import { AppError, fn } from "tailorkit/server";
import type { Identity } from "tailorkit/server";
import * as v from "valibot";

import { db as database } from "#db";
import { notes } from "#db/schema";

const subject = (identity: Identity): string => {
  if (!identity.subjectId) {
    throw new AppError("UNAUTHORIZED", "Sign in to use private notes.");
  }
  return identity.subjectId;
};

export const list = fn.query.database(database).handler(({ db, identity }) =>
  db.query.notes
    .findMany({
      where: { ownerId: subject(identity) },
      columns: { id: true, title: true, archived: true, createdAt: true },
      orderBy: { createdAt: "desc", id: "desc" },
      limit: 50,
    })
    .sync()
);

export const add = fn.mutation
  .database(database)
  .input(
    v.object({
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    })
  )
  .handler(({ db, identity, input }) => {
    const id = crypto.randomUUID();
    db.insert(notes)
      .values({
        id,
        ownerId: subject(identity),
        title: input.title,
        createdAt: Date.now(),
      })
      .run();
    return { id };
  });

export const setArchived = fn.mutation
  .database(database)
  .input(
    v.object({
      id: v.pipe(v.string(), v.minLength(1)),
      archived: v.boolean(),
    })
  )
  .handler(({ db, identity, input }) => {
    const saved = db
      .update(notes)
      .set({ archived: input.archived })
      .where(and(eq(notes.id, input.id), eq(notes.ownerId, subject(identity))))
      .returning({ id: notes.id })
      .get();
    if (!saved) {
      throw new AppError("NOT_FOUND", "This note is unavailable.");
    }
    return saved;
  });

export const remove = fn.mutation
  .database(database)
  .input(v.object({ id: v.pipe(v.string(), v.minLength(1)) }))
  .handler(({ db, identity, input }) => {
    const removed = db
      .delete(notes)
      .where(and(eq(notes.id, input.id), eq(notes.ownerId, subject(identity))))
      .returning({ id: notes.id })
      .get();
    if (!removed) {
      throw new AppError("NOT_FOUND", "This note is unavailable.");
    }
    return removed;
  });
```

Keep `subject` private to this module: only function definitions go into `defineServer`. Each mutation is one transaction; a bulk operation that must be atomic belongs in one mutation too.

## Fetch and validate external data in an action

This read-only example combines an authorized app query with a public external read. Replace the example-domain URL with the endpoint required by the feature. Use a product server tool for an integration requiring product credentials. The runtime does not deploy secrets from the build machine.

<!-- example: src/functions/preview.ts -->

```ts
import { AppError, fn } from "tailorkit/server";
import * as v from "valibot";

import * as notes from "./notes";

const result = v.object({ summary: v.pipe(v.string(), v.maxLength(2000)) });

export const preview = fn.action
  .functions({ notes })
  .output(result)
  .handler(async ({ queries, signal }) => {
    const visibleNotes = await queries.notes.list();
    const response = await fetch("https://data.example/summary.json", {
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      throw new AppError("UNAVAILABLE", "The summary service is unavailable.");
    }
    const external = v.parse(result, await response.json());
    return {
      summary: `${visibleNotes.length} notes. ${external.summary}`.slice(
        0,
        2000
      ),
    };
  });
```

For writes to an external service, persist an operation key and reuse it on retry according to that service's idempotency API. A disconnected action may already have committed work. Keep related database changes in one mutation, await every effect, and provide a way to reconcile partial completion. Validate and bound external responses before storing or returning them; an output schema does not itself cap downloaded bytes.

<!-- example: src/server.ts -->

```ts
import { defineServer } from "tailorkit/server";

import * as notes from "#functions/notes";
import { preview } from "#functions/preview";

export default defineServer({ notes, preview });
```

`useQuery(api.notes.list)` provides reactive lists. Use `useMutation` for add/archive/remove and `useAction` for preview. Host context identifiers are validated input, not authorization; for team or record sharing, enforce the product's membership/access rules through a trusted capability before accessing that data.
