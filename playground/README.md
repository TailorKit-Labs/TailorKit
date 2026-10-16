# TailorKit playground

Use the playground to try TailorKit contracts and apps against a local host. The TanStack Start host in `playground/tanstack-start` includes a SQLite-backed issue tracker and a passwordless profile picker. The Todo app uses the host’s client tools to scope todos to the selected team.

## Start the playground

From the repository root, install dependencies and start the local TailorKit platform in one terminal:

```sh
pnpm install
pnpm dev
```

Prepare and seed the playground database, then start the host in another terminal:

```sh
pnpm playground:db:push
pnpm playground:db:seed
pnpm playground:dev
```

Open the [playground at localhost:5010](http://localhost:5010). Choose one of the demo profiles and teams. The demo sign-in is local-only and does not use passwords. To reset the database, delete `playground/shared/.data/playground.sqlite`, then run `pnpm playground:db:push` followed by `pnpm playground:db:seed`. This removes your local playground data.

## Apps and contracts

The Todo app builds with Vite+ and the TailorKit plugin in `vite.config.ts`. Run `pnpm playground:todo:build` from the repository root, or `pnpm build` from `playground/apps/todo`. Build aliases and custom plugins belong in that Vite configuration. Host and backend settings remain in `tailorkit.config.ts`. Lint and format settings are inherited from the repository's root configuration; the app also provides `check`, `fix`, `lint`, and `format` scripts.

The app in `playground/apps/todo` uses the host's `todos` client tools, whose API is defined in the active contract. To try a different validation library, change the export in `playground/shared/src/contracts/active.ts` to `./valibot` or `./arktype`, then run:

```sh
pnpm playground:generate
pnpm playground:todo:build
```

`playground:generate` serializes the selected contract to `playground/schema.json`, then runs `tailorkit generate --schema` for the todo app. It does not need the host to be running. The file contains the raw schema object accepted by `tailorkit generate --schema`, matching the `schema` value inside the host's `/meta` response.

The host contract exposes these components: the standard `Box`, `Flex`, `Grid`, `Inline`, and `Pressable` primitives, plus `Button` and `Input`. The host maps `Button` and `Input` to `@tailorkit/ui` and uses the standard React renderers for primitives.

The Todo panel includes a Pressable prototype with inline, box, flex, and grid layouts. Try hover, hold, keyboard focus and activation, and the disable toggle.

Every primitive style prop accepts a token string or a conditional object:

```tsx
<Pressable
  background={{
    default: "surface",
    ":hover": "hover",
    ":active": { default: "pressed", lg: "hover" },
  }}
  borderColor={{ default: "default", ":focus-visible": "focus" }}
  padding={{ default: "sm", lg: "md" }}
  textColor={{ ":disabled": "muted" }}
  onPress={openProject}
>
  Open project
</Pressable>
```

Use `background="surface"` when no conditions are needed. Supported states are `:hover`, `:active`, `:focus-visible`, and `:disabled`. State values accept a token or a breakpoint object; combine conditions by nesting breakpoints inside a state. `default` supplies the fallback independently of configured breakpoints. Breakpoint names come from `primitives(theme)`; `default` and names beginning with `:` produce type errors and are rejected at runtime. A breakpoint named `hover` is distinct from the `:hover` state.

Within a property, later matching breakpoint entries override earlier ones. List minimum-width breakpoints from smaller to larger for the usual responsive behavior. State styles override ordinary breakpoint styles; active styles override focus-visible and hover styles on conflicting properties. Disabled Pressables ignore the other interaction states. `onPress` runs on activation; state styling stays in the host. Use text or `Inline` children inside the native button and keep nested controls outside it.

This changes the fallback key from `base` to `default`. Remove the old `base: null` breakpoint and replace `base` keys in conditional style values with `default`. Generated types reflect the contract's breakpoint names and supported pseudo-classes.

The contracts in `playground/shared/src/contracts/` are deliberately written with each validator's native API. Keep their components, views, scopes, tools, and validation behavior aligned when editing them.

## Update the playground database

The host data model is in `playground/shared/src/db/schema.ts`. It uses Drizzle with Node's built-in SQLite driver. Push schema changes with `pnpm playground:db:push`; this playground does not keep migration files. Profiles, teams, memberships, and starter issues are seeded by `pnpm playground:db:seed`.
