# Queries, mutations, actions, and reactive clients

For private records, CRUD writes, or external integration actions, read the [complete functions recipe](references/functions.md). It includes the database, authorization on each operation, registration, and an action with response validation.

## Choose the execution boundary

App backend code runs in a Cloudflare Workers/Durable Object sandbox, with Web APIs and installation-scoped SQLite supplied by TailorKit. It is not a Node server: do not add an HTTP listener, filesystem storage, a database driver, or a Wrangler deployment. Choose dependencies compatible with that runtime. In-memory module state is not durable storage, and build-machine environment variables are not deployed app secrets.

Enable `server: {}` in `tailorkit.config.ts`. Define functions with `fn` from `tailorkit/server`, register them in the configured server entry, and regenerate bindings to expose typed `api` references. Pick the function kind by its effects:

| Kind | Purpose | Available capabilities |
| --- | --- | --- |
| Query | Read app-owned data reactively. | Synchronous read-only `db`, verified `identity`. |
| Mutation | Change app-owned data atomically. | Synchronous read/write `db`, verified `identity`. |
| Action | Await external services or host server tools. | `queries`, `mutations`, `tools`, `identity`, `scope`, `requestId`, `signal`; no direct `db`. |

## Define and register functions

Chain `.input(zodSchema)` and optional `.output(zodSchema)` before `.handler(...)`. Builder handlers receive `input`; omit `.input` for an inputless function. Inputs and outputs must support synchronous validation. Return serializable data: plain objects, arrays, strings, numbers, booleans, or null. Convert dates and special objects deliberately, and return null for an absent record.

Register definitions explicitly with `defineServer({ notes })` in the configured entry; the recipe shows the files and registration together.

Nested objects establish function namespaces, such as `api.notes.list`. Files are not registered automatically. Modules spread into the registration should export function definitions, not unrelated helpers. The alternative object-style `query`, `mutation`, and `action` API names its validated argument `args`; do not mix that signature with the builder's `input`.

## Synchronous database handlers

Queries and mutations must finish synchronously: no async handler, promise-returning database read, network request, host tool call, or delayed work. Attach `.database(database)` for typed relational queries. Complete reads with `.sync()` or select `.all()`/`.get()`, and writes with `.run()` or `.returning(...).all()`/`.get()`. Return results rather than a query builder.

A mutation runs inside one database transaction. Throwing rolls back its writes; do not open a nested transaction or retain its database handle after the handler returns. Query subscriptions track tables read and rerun after committed writes to those tables. Put fetching or other side effects in an action so database handlers remain short and atomic.

## Actions and external work

Use `fn.action.functions({ notes }).input(...).handler(async ({ input, queries, mutations, tools, signal }) => ...)` to declare access to registered definitions under the same names used in `defineServer`. Then await `queries.notes.list()` or `mutations.notes.add({ title })`. These helpers call queries and mutations, not other actions. An action cannot attach `.database(...)` or access a raw database connection.

Actions can await public HTTPS fetch requests; local/private-network destinations are unavailable. Pass `signal` to fetch, check HTTP status, validate the response, and bound returned data. Use the typed context `tools` for host-provided server tools; generated frontend tools can include client tools that are not available on the backend. For credentialed host integrations, use an exposed server tool rather than assuming cookies, host process.env, or user credentials are available.

Every action mutation commits separately. External API calls and multiple mutations do not form one transaction. Keep invariants that must change together in a single mutation; use application-level idempotency and persisted progress for retryable external side effects. Do not blindly retry an action after a disconnect. Cancellation does not undo already committed mutations or external work. Await work before returning; the request, authorization expiry, or a new deployment can end the action, and this runtime does not provide an implicit background-job queue.

## Identity and errors

Handlers receive trusted `identity`, including installation/app/project identifiers, authorized scope, and an optional `subjectId`. Validate the permissions relevant to the operation. Installation isolation does not imply per-user or per-context isolation. Frontend view context is not automatically injected into a function; pass required identifiers as validated input and authorize them on the backend. A client-supplied record ID, user ID, or filter is input to validate, not proof of access. Return only data the caller may see.

Throw `new AppError(code, message)` from `tailorkit/server` for expected failures, using codes such as `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, or `CONFLICT`. Unexpected exceptions become a generic app-function failure. Use actionable messages without credentials or private diagnostics.

## Reactive Preact clients

Keep `<ClientProvider>` from `tailorkit/client` mounted above consumers. Import `api` from the generated bindings and use SDK hooks:

```ts
const notes = useQuery(api.notes.list);
const add = useMutation(api.notes.add, { onSuccess: () => closeEditor() });
```

`useQuery(ref, input?, options?)` subscribes and updates after committed writes. Render `data`, `error`, `isLoading`, and `isError`; pending data is undefined. Keep hooks unconditional. To defer a query, set `{ enabled: false }` in the third argument; pass explicit `undefined` as the second argument for an inputless query. Disabled queries are pending but not loading.

Mutations expose `mutate` (void) and `mutateAsync` (promise); actions expose `execute` and `executeAsync`. Use the async form when subsequent work depends on completion or needs try/catch. Hooks expose pending, error, success, result, reset, and optional success/error callbacks. Prevent duplicate submissions and preserve drafts on failure. Use subscriptions instead of polling or manual refetch after a write. See the frontend skill for input responsiveness across the asynchronous host bridge.
