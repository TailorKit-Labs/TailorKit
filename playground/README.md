# TailorKit playground

A small local host product for trying TailorKit contracts and apps. The host is
TanStack Start, with a SQLite-backed issue tracker and a passwordless profile
picker. The todo app uses the host's client tools, so todos are scoped to the
selected team.

## Start the playground

From the repository root, install dependencies and start the local TailorKit
platform in one terminal:

```sh
pnpm install
pnpm dev
```

Prepare and seed the playground database, then start the host in another
terminal:

```sh
pnpm playground:db:push
pnpm playground:db:seed
pnpm playground:dev
```

Open <http://localhost:5010>. Choose one of the demo profiles and teams. The
demo sign-in is local-only and does not use passwords. The SQLite database is
stored at `playground/shared/.data/playground.sqlite`; delete that file and run
`pnpm playground:db:push` followed by `pnpm playground:db:seed` to reset it.

## Apps and contracts

The single app is `playground/apps/todo`. It uses the host's `todos` client
tools, whose API is defined in the active contract. To try a different
validation library, change the export in
`playground/shared/src/contracts/active.ts` to `./valibot` or `./arktype`, then
run:

```sh
pnpm playground:generate
pnpm playground:todo:build
```

`playground:generate` serializes the selected contract to
`playground/schema.json`, then runs `tailorkit generate --schema` for the todo
app. It does not need the host to be running. The file contains the raw schema
object accepted by `tailorkit generate --schema`, matching the `schema` value
inside the host's `/meta` response.

The host contract exports a small TailorKit component surface: the standard
`Box`, `Flex`, `Grid`, and `Inline` primitives, plus `Button` and `Input`. The
host maps those components to `@tailorkit/ui`.

The contracts in `playground/shared/src/contracts/` are deliberately written
with each validator's native API. Keep their components, views, scopes, tools,
and validation behavior aligned when editing them.

## Database

The host data model is in `playground/shared/src/db/schema.ts`. It uses Drizzle
with Node's built-in SQLite driver. Push schema changes with
`pnpm playground:db:push`; this playground does not keep migration files.
Profiles, teams, memberships, and starter issues are seeded by
`pnpm playground:db:seed`.
