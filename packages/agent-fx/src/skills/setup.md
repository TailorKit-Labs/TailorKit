# App setup, generation, and publication

## Inspect before scaffolding

Work from the app root, `/workspace/app`. Check for an existing package.json, lockfile, TailorKit configuration, and source before running initialization. Keep an existing app's package manager, scripts, SDK version, build plugins, and identity. Install dependencies using its own lockfile and configuration.

For an empty app directory, the TailorKit CLI creates a Preact and TypeScript app against the supplied host. A noninteractive pnpm example is:

```sh
PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm dlx tailorkit@beta init /workspace --name app --host '<supplied-host-url>' --package-manager pnpm --tooling vite-plus --force --no-install
```

Replace the host placeholder with the supplied URL, quoted as one shell argument. `init` creates `/workspace/app` from this parent directory and name. Use `--force` only after confirming there is no existing app or source to overwrite. If the directory contains partial or unfamiliar work, inspect and repair it instead. Use a different package manager or tooling when the app or user requires it. Install dependencies in the generated app and follow its scripts.

The agent sandbox resolves fresh packages without a release-age delay or a reused `dlx` resolution. The environment setting also tells newer CLIs to resolve fresh scaffold dependencies; older CLIs ignore it without failing. `@beta` is TailorKit's current release channel; keep the SDK version selected by that CLI. The generated pnpm configuration allows esbuild's install script: Drizzle Kit requires it for database tooling even when Vite+ uses Rolldown for app builds. Keep build permissions scoped to required packages.

If a schema file was supplied, add `--schema <supplied-schema-path>` to initialization and subsequent generation. This uses the provided contract instead of fetching it from the host. Keep that document intact. Without a supplied schema, the CLI fetches the contract from the configured host URL.

## Configuration and generated code

`tailorkit.config.ts` describes the app: `host`, `name`, `slug`, optional linked `appId`, optional `logos`, and optional `server`. Keep existing identity fields when editing. The agent's deployment tool selects the authorized app; changing appId does not authorize another destination.

The Vite configuration must retain the TailorKit plugin from `tailorkit/vite` and the app's Preact setup. It discovers views and generates the deployment manifest. Preserve working configuration rather than replacing it with a generic React or web-app starter.

For backend functions or repeated-slot resolvers, add `server: {}`. Defaults are `src/server.ts` and `src/db/migrations`; custom `server.entry` and `server.migrations` paths are relative to the app root. Backend source files alone do not enable a server bundle. Client-only apps can omit `server`.

Run the app's generation script, commonly `pnpm run generate`, or its package manager's equivalent of `tailorkit generate`, after initialization, host contract changes, or backend registration changes. Include the supplied schema argument when present. Generated `#tailorkit` bindings expose host components and tools, slot/context types, and app `api` references when a backend is enabled. Resolve type errors by correcting configuration, registration, or app code and regenerating.

The usual source layout is:

| Location | App code |
| --- | --- |
| `src/slots/<slot>/**/*.view.tsx` | Discovered frontend views. |
| `src/root.tsx`, slot roots, and layouts | Shared frontend shells. |
| `src/functions/`, `src/server.ts` | Backend function definitions and registration. |
| `src/db/schema.ts`, `relations.ts`, `index.ts` | SQLite tables and typed database definition. |
| `src/db/migrations/` | Generated SQL and schema snapshots. |

These are scaffold defaults; inspect an existing app's configured paths and aliases.

## Resolve unfamiliar SDK APIs

Use `tailorkit/client` for frontend APIs, `tailorkit/server` for backend functions, `tailorkit/db` for database APIs, and `tailorkit/vite` for the build plugin. The database skill covers schema builders, relations, database definitions, and query helpers.

Generation creates `.agents/skills/tailorkit-host/SKILL.md` for project skill discovery. Read it to select the relevant host references; it points to the component catalog, slots/context, styling, and host operations without loading all contracts. Component pages describe accepted props, callback payloads, and children; the adjacent focused `.ts` module supplies exact types when needed. An older CLI may generate only one bindings file; use bounded searches in it for the relevant declarations.

For SDK APIs absent from the skills, inspect only the installed public declaration needed. The umbrella package re-exports transitive SDK packages; pnpm may not expose those packages at the app's top-level node_modules. Resolve their package location through the umbrella import before assuming an API is missing. For database declarations, resolve `@tailorkit/app-db` through `tailorkit/db` from the app root:

```sh
node --input-type=module -e 'import { findPackageJSON } from "node:module"; import { dirname, join } from "node:path"; console.log(join(dirname(findPackageJSON("@tailorkit/app-db", import.meta.resolve("tailorkit/db"))), "dist"));'
```

Read `index.d.ts` there and follow the declaration imports relevant to the task. Keep app imports on `tailorkit/db`; `@tailorkit/app-db` is its backing package. Bound searches to relevant declarations and source lines so bundled implementation code does not fill the conversation.

## Build and deploy

Use the existing app's scripts for lint, formatting, and relevant tests. For the default Vite+ scaffold, `check` checks lint and formatting; run formatting fixes before it, review the changes, and run tests without watch mode only when tests exist.

Call the agent's `deploy` tool after implementation and these checks. It runs TypeScript checking and the Vite build, validates the build manifest, uploads artifacts, and publishes them. The client bundle is loaded in the browser iframe. The optional server bundle and its migrations are private and run on Cloudflare. Logo files configured for dark/light mode can be SVG, PNG, or WebP. Keep server code and secrets out of client imports and public assets.

For manifest or build errors, check view declarations, generated bindings, the TailorKit Vite plugin, server configuration, and migration drift. Generate missing migrations rather than disabling the check. For oversized bundles, remove unused dependencies and browser/Node packages incompatible with the target runtime. Do not replace the managed publication path with a Vercel, Wrangler, or standalone-server deployment.
