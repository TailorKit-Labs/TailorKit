# TailorKit apps

A TailorKit app adds UI and behavior to an existing product, called the host. `/workspace/app` contains the app source, whether creating a new app or editing an existing one.

## Host integration

The host can expose components, tools, slots (UI locations), and context (such as page or selected-record data). App UI uses Preact and host components, which the host renders. Callbacks receive declared values rather than DOM events.

Tools run host-defined code with declared inputs and results. Client tools run in the host's frontend; server tools run in its backend. App UI can call both; app actions can call server tools.

`#tailorkit` exports generated host bindings and app function references. `.agents/skills/tailorkit-capabilities/SKILL.md` describes the available host capabilities. `tailorkit-frontend` covers components and tools; `tailorkit-views` covers UI placement, context, and routing.

## App data

Component state holds temporary values such as drafts and filters. Managed SQLite provides persistent storage for features such as notes or saved settings. Each installation has its own database; backend functions control which users can access its data.

App backend functions include queries for reading data, mutations for transactional changes, and actions for work such as calling external services or server tools. TailorKit hosts this backend and database. `tailorkit-functions` covers these APIs and access rules; `tailorkit-database` covers tables, relationships, and migrations.

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

App identity lives in `tailorkit.config.ts`: `name` is the display name; `appId` and `slug` identify the app across updates.

The `deploy` tool formats, lints, tests, typechecks, builds, and publishes new apps or updates.
