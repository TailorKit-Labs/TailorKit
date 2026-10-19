# App functions

Enable `server: {}`. Use `fn` from `tailorkit/server`: queries read reactively, mutations write atomically, and actions await external work. Queries/mutations are synchronous; actions use `queries`, `mutations`, and exposed server `tools` instead of a direct `db`.

Chain `.input(schema)` and optional `.output(schema)` with synchronous Standard Schema v1-compatible validators. Builder handlers receive validated `input`. Return JSON-compatible values, using `null` for absence. Register definitions explicitly and regenerate bindings.

## Small example

This uses the database skill's `todos` table, shared by the installation. For private records, add ownership from verified identity and enforce it in every read/write.

```ts
// src/functions/todos.ts
import { fn } from "tailorkit/server";
import * as v from "valibot";

import { db as database } from "#db";
import { todos } from "#db/schema";

export const list = fn.query
  .database(database)
  .handler(({ db }) =>
    db.query.todos.findMany({ orderBy: { id: "asc" }, limit: 100 }).sync()
  );

export const add = fn.mutation
  .database(database)
  .input(v.object({ title: v.pipe(v.string(), v.trim(), v.minLength(1)) }))
  .handler(({ db, input }) => {
    const id = crypto.randomUUID();
    db.insert(todos).values({ id, title: input.title }).run();
    return { id };
  });
```

```ts
// src/server.ts
import { defineServer } from "tailorkit/server";

import * as todos from "#functions/todos";

export default defineServer({ todos });
```

Under `ClientProvider`, use `useQuery(api.todos.list)` and `useMutation(api.todos.add)` from `tailorkit/client`. Render hook data/loading/error state directly; writes refresh affected queries. Use `mutate`/`execute` in ordinary callbacks, and their async variants when later work needs a result. Keep hooks unconditional; mount a record's query component when its required ID is available. For inputless queries with options, preserve the second argument: `useQuery(api.todos.list, undefined, { enabled: isOpen })`.

## Runtime details when needed

Execute relational reads with `.sync()`, selects with `.all()`/`.get()`, and writes with `.run()` or `.returning(...).all()`/`.get()`. A mutation owns one transaction and rolls back on throw. Database handles are valid only during the handler.

For actions calling app functions, declare `.functions({ todos })` and use `queries.todos.list()` or `mutations.todos.add(input)`. Public fetches use `signal`, status checks, and response validation. Product credentials remain behind exposed server tools. External effects and separate mutations do not form one transaction; choose retry behavior for the operation being implemented.

`identity` is verified, but `subjectId` is optional. Installation isolation is not user authorization. Use `AppError` from `tailorkit/server` for expected failures. For uncovered APIs, inspect installed public declarations behind `tailorkit/server` or `tailorkit/client`.
