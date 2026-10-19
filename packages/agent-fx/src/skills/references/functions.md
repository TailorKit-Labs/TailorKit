# Small backend examples

Use these patterns only for app-owned data. Product-owned records use generated tools. This notes example is private to the signed-in user; use installation-wide sharing when that is the feature's intended access model.

Enable `server: {}`, generate migrations after adding tables, and regenerate bindings after registration.

## Notes: table, query, and mutation

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

The caller cannot choose the owner. Apply the same ownership condition to edit/delete operations when adding those features. Return only the fields needed by the UI.

## Public external data

An external lookup needs an action, not another database layer. Replace the example URL with the feature's actual endpoint. Credentialed product integrations use exposed server tools.

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

## Register what the app uses

<!-- example: src/server.ts -->

```ts
import { defineServer } from "tailorkit/server";

import notes from "#functions/notes";
import preview from "#functions/preview";

export default defineServer({ notes, preview });
```

Use `useQuery(api.notes.list)`, `useMutation(api.notes.add)`, or `useAction(api.preview.summary)` from the client. An app needing only notes can omit the external action and its registration.
