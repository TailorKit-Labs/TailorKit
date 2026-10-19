# TailorKit apps

A TailorKit app adds UI and behavior to an existing product, called the host. `/workspace/app` contains the app source, whether creating a new app or editing an existing one.

## Host integration

The host exposes components, tools (product operations), slots (UI locations), and context (page or selected-record data). App UI uses Preact and generated host components, which the host renders. Callbacks receive declared values rather than DOM events.

`#tailorkit` exports generated host bindings and app function references. `.agents/skills/tailorkit-capabilities/SKILL.md` describes the available host capabilities. `tailorkit-frontend` covers components and tools; `tailorkit-views` covers UI placement, context, and routing.

## App data

Host tools access records the product owns. Component state holds temporary values such as drafts and filters. App-owned persistent data, such as notes or saved settings, lives in SQLite. Each installation has its own database, shared by its users.

Backend queries read data, mutations save changes in a transaction, and actions call external services or host tools. `tailorkit-functions` covers these APIs and access rules; `tailorkit-database` covers tables, relationships, and migrations. TailorKit hosts the backend and database.

## App files

| Path | Purpose |
| --- | --- |
| `tailorkit.config.ts` | Host URL, app identity, and backend options. |
| `vite.config.ts` | TailorKit/Preact build configuration. |
| `src/tailorkit.gen.ts` | Generated bindings (`#tailorkit`). |
| `src/root.tsx` | Shared UI/providers around views. |
| `src/slots/<slot>/` | UI views (`*.view.tsx`), roots, and layouts. |
| `src/functions/` | Backend function modules. |
| `src/server.ts` | Backend function registration. |
| `src/db/` | Tables, relationships, database builder, and migrations. |

These are the default locations; existing apps may configure different backend paths.

## App identity and deployment

App identity lives in `tailorkit.config.ts`: `name` is the display name; `appId` and `slug` identify the app. Existing edits retain its ID, slug, data, and unrelated behavior. An unpublished app may already contain work.

The `deploy` tool formats, lints, tests, typechecks, builds, and publishes new apps or updates.
