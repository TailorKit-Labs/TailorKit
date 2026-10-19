# Load and save app data

App functions run on TailorKit's managed backend. Use them to store app data or call external services. Enable `server: {}` in `tailorkit.config.ts`.

| Function | Use | Handler access |
| --- | --- | --- |
| Query | Read saved data and subscribe to changes | Synchronous read-only `db`, verified `identity` |
| Mutation | Save changes in one transaction | Synchronous read/write `db`, verified `identity` |
| Action | Call external services or host tools | Async `queries`, `mutations`, server `tools`, `identity`, `signal` |

## Define and register functions

Use the shared `fn` from `#db` for database functions; use `fn` from `tailorkit/server` for standalone actions. Chain `.input(schema)` and optional `.output(schema)` before `.handler(...)`.

A schema validates accepted values. Use Valibot for new schemas or keep the app's existing Standard Schema v1 validator; function schemas validate synchronously. Handlers receive validated `input`; inputless functions omit `.input`. Return JSON-compatible data, using `null` for an absent result.

Group a module's functions with `export default defineRouter({ list, add })` from `tailorkit/server`. Import that router as `notes` in `src/server.ts` and export `defineServer({ notes })`. Run `pnpm run generate` to make `api.notes.list` and `api.notes.add` available in `#tailorkit`. The [backend examples](references/functions.md) show the complete files.

## Database access and identity

Bind the database once with `createFunctions({ database: db })` in `src/db/index.ts`; handlers then receive typed `db`. Queries and mutations finish synchronously. The database guide covers reads and writes; use actions for network calls.

`identity` describes the verified caller and installation. `identity.subjectId` is the user ID when available. For private records, require it and filter every read/update/delete by that owner. For shared records, enforce the intended shared access rule. Caller-supplied IDs alone do not grant access. Throw `AppError` from `tailorkit/server` for expected failures, such as `UNAUTHORIZED` or `NOT_FOUND`.

## External services and client hooks

Actions use `fetch` or exposed server `tools`; they have no `db`. Declare `.functions({ notes })` to call `queries.notes.list()` or `mutations.notes.add(input)`. Each mutation commits separately. Pass `signal` to fetch, handle unsuccessful responses, and validate returned data. Design external writes for the service's retry behavior.

Under `ClientProvider`, call `useQuery(api.notes.list)`, `useMutation(api.notes.add)`, or `useAction(api.preview.summary)` from `tailorkit/client`. Queries subscribe to saved data; committed mutations update affected subscriptions. Render hook data/loading/error state directly. Call `mutate` or `execute` in callbacks; use `mutateAsync` or `executeAsync` when awaiting the result.

Mount a query component once its required record ID exists. To defer an inputless query, use `useQuery(api.notes.list, undefined, { enabled: isOpen })`.
