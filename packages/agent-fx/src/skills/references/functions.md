# App function examples

These examples show database queries and mutations, an action that calls an external service, and function registration in `src/server.ts`.

Enable `server: {}` in `tailorkit.config.ts`. After adding these files, run `pnpm run db:generate` and `pnpm run generate`.

## Notes: table, query, and mutation

This example stores private notes owned by the signed-in user. For shared notes, use the feature's intended access rule. Host-owned records use host tools instead.

Define the stored fields, include the tables in the database, and create the shared function builder:

<!-- example: src/db/schema.ts -->

```ts
import { table, text } from "tailorkit/db";

export const notes = table("notes", {
  id: text().primaryKey(),
  ownerId: text().notNull(),
  title: text().notNull(),
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
import { createFunctions } from "tailorkit/server";

import { relations } from "./relations";

export const db = defineDatabase({ relations });
export const fn = createFunctions({ database: db });
```

<!-- example: src/functions/notes.ts -->

```ts
import { defineRouter, AppError } from "tailorkit/server";
import type { Identity } from "tailorkit/server";
import * as v from "valibot";

import { fn } from "#db";
import { notes } from "#db/schema";

const subject = (identity: Identity): string => {
  if (!identity.subjectId) {
    throw new AppError("UNAUTHORIZED", "Sign in to use private notes.");
  }
  return identity.subjectId;
};

const list = fn.query.handler(({ db, identity }) =>
  db.query.notes
    .findMany({
      where: { ownerId: subject(identity) },
      columns: { id: true, title: true },
      orderBy: { id: "asc" },
      limit: 50,
    })
    .sync()
);

const add = fn.mutation
  .input(
    v.object({
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
    })
  )
  .handler(({ db, identity, input }) => {
    const id = crypto.randomUUID();
    db.insert(notes)
      .values({ id, ownerId: subject(identity), title: input.title })
      .run();
    return { id };
  });

export default defineRouter({ list, add });
```

`identity.subjectId` supplies the owner; input cannot choose it. `list` reads that owner's notes, and `add` saves one. Use the same owner filter for edits/deletes.

## Public external data

Use an action for an external request. Replace the URL with the requested service's endpoint. For a host integration, use its exposed server tool.

<!-- example: src/functions/preview.ts -->

```ts
import { AppError, defineRouter, fn } from "tailorkit/server";
import * as v from "valibot";

const result = v.object({ summary: v.pipe(v.string(), v.maxLength(2000)) });

const summary = fn.action.output(result).handler(async ({ signal }) => {
  const response = await fetch("https://data.example/summary.json", { signal });
  if (!response.ok) {
    throw new AppError("UNAVAILABLE", "The summary service is unavailable.");
  }
  return v.parse(result, await response.json());
});

export default defineRouter({ summary });
```

## Expose functions to the UI

Register the routers in `src/server.ts`; their names become `api.notes` and `api.preview` in generated bindings:

<!-- example: src/server.ts -->

```ts
import { defineServer } from "tailorkit/server";

import notes from "#functions/notes";
import preview from "#functions/preview";

export default defineServer({ notes, preview });
```

After generation, import `api` from `#tailorkit`. Use `useQuery(api.notes.list)`, `useMutation(api.notes.add)`, or `useAction(api.preview.summary)` under `ClientProvider`. An app needing only notes omits `preview` and its file.
