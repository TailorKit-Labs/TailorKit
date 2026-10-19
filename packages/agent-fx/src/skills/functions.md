# Backend functions

App functions run on TailorKit's managed backend. Enable `server: {}` in `tailorkit.config.ts`; no separate server deployment is needed.

| Function | Use | Handler access |
| --- | --- | --- |
| Query | Read saved data and subscribe to changes | Synchronous read-only `db`, verified `identity` |
| Mutation | Save changes in one transaction | Synchronous read/write `db`, verified `identity` |
| Action | Call external services or host tools | Async `queries`, `mutations`, server `tools`, `identity`, `signal` |

## Queries and mutations

Database functions use `fn` from `#db`. These snippets use the shared `notes` table (`id`, `title`) from `tailorkit-database`.

A query reads data synchronously. For example, in `src/functions/notes.ts`:

<!-- example: src/functions/notes.ts -->

```ts
import { fn } from "#db";

const list = fn.query.handler(({ db }) =>
  db.query.notes.findMany({ limit: 50 }).sync()
);
```

Add a mutation in the same module to validate and save input:

<!-- continue: src/functions/notes.ts -->

```ts
import * as v from "valibot";

import { notes } from "#db/schema";

const add = fn.mutation
  .input(v.object({ title: v.pipe(v.string(), v.trim(), v.minLength(1)) }))
  .handler(({ db, input }) => {
    const id = crypto.randomUUID();
    db.insert(notes).values({ id, title: input.title }).run();
    return { id };
  });
```

Queries, mutations, and their validators finish synchronously; each mutation runs in one transaction. Use Valibot or the app's existing Standard Schema v1 validator. `.output(schema)` validates results. Return JSON-compatible data, with `null` for an absent result.

## Function registration

A router groups named functions. Export the handlers from the same module:

<!-- continue: src/functions/notes.ts -->

```ts
import { defineRouter } from "tailorkit/server";

export default defineRouter({ list, add });
```

Register routers in `src/server.ts`, then run `pnpm run generate`. Router names become API namespaces such as `api.notes.list`:

<!-- example: src/server.ts -->

```ts
import { defineServer } from "tailorkit/server";

import notes from "#functions/notes";
export default defineServer({ notes });
```

## Actions

Use `fn` from `tailorkit/server` for actions without a database. This action fetches a summary; replace the URL with the requested service:

<!-- example: src/functions/preview.ts -->

```ts
import { AppError, defineRouter, fn } from "tailorkit/server";
import * as v from "valibot";

const result = v.object({ summary: v.string() });
const summary = fn.action.output(result).handler(async ({ signal }) => {
  const response = await fetch("https://data.example/summary.json", { signal });
  if (!response.ok) {
    throw new AppError("UNAVAILABLE", "The summary service is unavailable.");
  }
  return v.parse(result, await response.json());
});

export default defineRouter({ summary });
```

Actions have no `db`. Declare `.functions({ notes })` to use `queries.notes.list()` or `mutations.notes.add(input)` in the handler. Each mutation commits separately. Use handler `tools` for host server operations. Pass `signal` to fetch and design external writes for the service's retry behavior.

## Access control

`identity` describes the verified caller. For private records, require `identity.subjectId` and filter reads, updates, and deletes by an owner column. Shared records follow the feature's shared access rule. Throw `AppError` for expected failures such as `UNAUTHORIZED` or `NOT_FOUND`; caller-supplied IDs do not grant access.

## Client hooks

After registering each function's router, import `api` from `#tailorkit`. Inside a component under `ClientProvider`:

<!-- example: src/examples/function-hooks.ts -->

```ts
import { useAction, useMutation, useQuery } from "tailorkit/client";

import { api } from "#tailorkit";

const notes = useQuery(api.notes.list);
const add = useMutation(api.notes.add);
const summary = useAction(api.preview.summary);
```

Render hook data/loading/error state. Queries subscribe to data; mutations refresh affected subscriptions. Call `mutate`/`execute` in callbacks or await `mutateAsync`/`executeAsync` for results.

Mount a query component once its required record ID exists. To defer an inputless query, use `useQuery(api.notes.list, undefined, { enabled: isOpen })`.
