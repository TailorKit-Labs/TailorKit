# Functions and SQLite

Enable `server: {}` in tailorkit.config.ts. Backend functions execute in Cloudflare Durable Objects with installation-scoped SQLite. Use the public `tailorkit/server` and `tailorkit/client` APIs; the scaffold supplies the database and provider setup.

Define functions with `fn.query`, `fn.mutation`, or `fn.action` from `tailorkit/server`. Chain `.input(zodSchema)`, optional `.output(zodSchema)`, and `.handler(({ input, ...context }) => ...)`. Register definitions explicitly in `src/server.ts` using `defineServer({ namespace })`, then regenerate bindings to expose `api` from `#tailorkit`.

Queries and mutations are synchronous. Attach `.database(database)` to access typed `db`. Queries read; mutations write atomically. Finish relational reads with `.sync()`, select builders with `.all()`/`.get()`, and writes with `.run()`. Awaiting fetch or other side effects belongs in actions. Actions have no direct db; declare `.functions({ namespace })` and call context `queries`/`mutations`. Validate external responses and pass the context signal to fetch.

Declare app-owned tables in `src/db/schema.ts` with `table`, `text`, `integer`, `real`, or `boolean` from `tailorkit/server`. Use Drizzle's `defineRelations(schema)` in `src/db/relations.ts` and `defineDatabase({ relations })` in `src/db/index.ts`. Generate IDs explicitly, scope reads and writes with trusted identity/context, and handle absent records. Installation storage is shared; user-supplied IDs do not establish authorization.

Run `pnpm run db:generate` for schema changes, inspect generated migrations, and preserve applied history. The build bundles migrations and checks drift; runtime applies migrations before handlers run. Use this capability instead of opening database connections or files.

In Preact, import `useQuery`, `useMutation`, and `useAction` from `tailorkit/client`, and generated `api` from `#tailorkit`. `useQuery(api.namespace.query, input)` subscribes reactively. Mutations offer `mutate`/`mutateAsync`; actions offer `execute`/`executeAsync`. Handle pending/error states and prevent duplicate submissions. An inputless query with options uses `undefined` as its second argument.

For API details not covered here, resolve installed public declarations through `tailorkit/server` or `tailorkit/client`; umbrella packages can re-export transitive SDK declarations.
