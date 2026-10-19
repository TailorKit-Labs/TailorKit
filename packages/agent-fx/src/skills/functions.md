# App functions

Use functions for app-owned data or external work. Enable `server: {}`. Import the shared `fn` from `#db` for database functions; use `fn` from `tailorkit/server` for standalone actions.

| Kind | Use | Capabilities |
| --- | --- | --- |
| Query | Reactive reads | Synchronous read-only `db`, verified `identity` |
| Mutation | Atomic writes | Synchronous read/write `db`, verified `identity` |
| Action | External calls | Async `queries`, `mutations`, server `tools`, `identity`, `scope`, `signal`, `requestId`; no `db` |

Chain `.input(schema)` and optional `.output(schema)` before `.handler(...)`. Schemas use Standard Schema v1 and must validate synchronously. Builder handlers receive `input`; inputless functions omit `.input`. Return JSON-compatible values and `null` for an absent result.

Export each function module with `export default defineRouter({ list, add })` from `tailorkit/server`. Import the default router as `notes` and register it with `defineServer({ notes })` in `src/server.ts`, then regenerate bindings. Names become `api.notes.list`, etc.; files alone do not register functions. See the [function examples](references/functions.md) for a small database-backed feature and an external action.

## Database work

Configure `export const fn = createFunctions({ database: db })` once in `src/db/index.ts`, using `createFunctions` from `tailorkit/server`. The shared builder supplies typed `db` in every query/mutation handler. Queries/mutations finish synchronously: execute relational reads with `.sync()`, select builders with `.all()`/`.get()`, and writes with `.run()` or `.returning(...).all()`/`.get()`. A mutation is already one transaction and rolls back on throw. Keep network work in actions.

An installation can have multiple users. Enforce the feature's access rules in every read/write using verified identity; caller-supplied IDs are not proof of access. `identity.subjectId` is optional. Throw `AppError` from `tailorkit/server` for expected errors, such as `UNAUTHORIZED` or `NOT_FOUND`.

## Actions and clients

For calls to app functions from an action, declare `.functions({ notes })`, then use `queries.notes.list()` or `mutations.notes.add(input)`. Use context `tools` for exposed product server operations. For public fetches, pass `signal`, check the status, and validate the response. Each mutation commits separately; external writes need retry semantics appropriate to the service.

Under `ClientProvider`, use `useQuery(api.notes.list)`, `useMutation(api.notes.add)`, and `useAction(api.preview.summary)`. Render hook data/loading/error state directly. Committed mutations refresh affected queries. Use `mutate`/`execute` for ordinary callbacks and their async variants when subsequent work needs a result. Avoid duplicating their state in custom hooks.

Keep hooks unconditional. For required record input, mount the consuming child when the ID exists. To defer an inputless query, use `useQuery(api.notes.list, undefined, { enabled: isOpen })`.
