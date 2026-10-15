# Backend functions and reactive clients

Enable `server: {}` in `tailorkit.config.ts`; the default entry is `src/server.ts`. Backend files are separate from the Preact iframe and run on the platform, not a Node.js app server. Do not add HTTP routes, a listener, a database driver, or a custom client transport.

## Locate public declarations when needed

Use the recipes below first. `tailorkit/server` re-exports `@tailorkit/app/server`; `tailorkit/client` re-exports `@tailorkit/app/client`. The umbrella declarations can therefore contain only re-exports. With pnpm, transitive packages need not exist in the app's top-level `node_modules/@tailorkit` directory.

To locate the installed app SDK's declarations from `/workspace/app`, resolve through the umbrella package:

```sh
node --input-type=module -e 'import { findPackageJSON } from "node:module"; import { dirname, join } from "node:path"; console.log(join(dirname(findPackageJSON("@tailorkit/app", import.meta.resolve("tailorkit/server"))), "dist"));'
```

Read `server.d.ts` or `client.d.ts` in that directory and follow only the declaration imports needed for the uncovered API. Keep app imports on the public `tailorkit/server` and `tailorkit/client` entry points.

## Define and register

Use `fn.query`, `fn.mutation`, and `fn.action` from `tailorkit/server`. Chain `.input(zodSchema)` and optionally `.output(zodSchema)` before `.handler(...)`. Handlers receive validated `input`; without an input schema it is `undefined`. Return JSON-compatible values (use `null` for an absent record).

For a `todos` table and database definition from the database skill:

```ts
// src/functions/todos.ts
import { fn } from "tailorkit/server";
import { z } from "zod";

import { db as database } from "../db";
import { todos } from "../db/schema";

export const list = fn.query
  .database(database)
  .handler(({ db }) => db.query.todos.findMany({ limit: 100 }).sync());

export const add = fn.mutation
  .database(database)
  .input(z.object({ title: z.string().trim().min(1).max(200) }))
  .handler(({ db, input }) => {
    const id = crypto.randomUUID();
    db.insert(todos).values({ id, title: input.title }).run();
    return { id };
  });
```

Register explicitly; files alone do not register functions:

```ts
// src/server.ts
import { defineServer } from "tailorkit/server";

import * as todos from "./functions/todos";

export default defineServer({ todos });
```

Regenerate bindings to expose `api.todos.list` and `api.todos.add`. Nested objects define namespaces. Export only callable definitions from modules spread into `defineServer`. The alternative object-style `query`/`mutation`/`action` API uses `args` in place of builder `input`.

## Runtime boundaries

- Queries read through `db`; mutations read and write. Attach `.database(database)` for typed relations. Both handlers must finish synchronously: no `async`, promises, fetch, host tools, timers, or external side effects. Execute reads with `.sync()` or `.all()`/`.get()` and writes with `.run()`.
- A mutation is atomic; thrown errors roll back its writes. Database handles expire when the handler returns.
- Actions may await `fetch` and exposed server tools through context `tools`; they have no `db`. Declare `.functions({ todos })` using the same definitions and namespaces as `defineServer`, then await `queries.todos.list()` or `mutations.todos.add({ title })`. These helpers cannot call actions. Pass context `signal` to fetch, check response status, and validate external data with Zod.
- Each action mutation commits separately. External work and multiple mutations are not one transaction; make retries safe for side effects. Persist external results with a mutation if reactive queries should update.
- Handlers receive verified `identity`; actions also receive `scope`. SQLite is shared within an installation, not automatically isolated per user or context record. For private or record-specific data, validate access and filter reads/writes using trusted identity/context identifiers. `identity.subjectId` is optional; do not assume a signed-in user or trust a supplied subject ID.
- For expected failures, throw `new AppError("NOT_FOUND", "Record no longer exists")` (import from `tailorkit/server`) or another supported code such as `FORBIDDEN` or `CONFLICT`. Unexpected errors become generic client failures. Never return secrets.

## Use from Preact

Keep the scaffold's stable `<ClientProvider><Route /></ClientProvider>` shell. Import hooks from `tailorkit/client` and `api` from `#tailorkit`:

```ts
const todos = useQuery(api.todos.list);
const add = useMutation(api.todos.add, { onSuccess: () => setTitle("") });
// In a generated host callback:
add.mutate({ title });
```

- `useQuery(ref, input?, options?)` subscribes reactively; committed writes rerun affected queries. Use `data`, `error`, `isLoading`, and `isError`; pending data is `undefined`. Do not poll or manually refetch after writes.
- Keep hooks unconditional. Defer with `{ enabled: false }` in the third argument; preserve `undefined` as the second argument for an inputless query with options. Disabled queries have `isLoading: false` and `isPending: true`.
- Mutations expose `mutate`/`mutateAsync`; actions expose `execute`/`executeAsync`. The non-async variants return void and report failures through hook state and optional `onError`; await the async variants when later behavior needs a result or caught error. Both hooks expose `data`, `error`, `isPending`, and `reset`. Disable duplicate submissions while pending.
