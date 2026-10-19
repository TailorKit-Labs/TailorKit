# Configure the app

Work in `/workspace/app`; dependencies and host bindings are installed. New apps start with configuration, bindings, and `src/root.tsx`. Add only the UI and backend files the feature needs. For choosing host tools, saved data, or local state, use the [data flow guide](references/workflows.md).

## Configuration and imports

Keep the TailorKit/Preact build setup. Enable `server: {}` in `tailorkit.config.ts` for app functions or repeated views. Backend code uses `src/server.ts`; database migrations use `src/db/migrations` unless configured otherwise. TailorKit hosts the backend; no separate server or database service is needed.

Use the public entry points: `tailorkit/client` for UI hooks/routing, `tailorkit/server` for functions, and `tailorkit/db` for SQLite definitions. New scaffolds provide `#tailorkit`, `#db`, `#db/*`, and `#functions/*` imports. For existing apps, use their declared aliases or relative imports. Consult installed public type declarations when an API is unfamiliar.

Keep the scaffold's dependency policy: third-party releases must be three days old; only `tailorkit` and `@tailorkit/*` are exempt. Preserve the SDK version and esbuild's allowed install script for database tooling.

## Generated bindings

Bindings connect the host's components/tools and your registered backend functions to typed imports. Run `pnpm run generate` after host contract or backend registration changes. Pass any supplied `--schema` path and preserve that file; otherwise generation uses the configured host URL. Change source definitions, then regenerate bindings and capability pages.

After table changes, run `pnpm run db:generate` to create migrations. The database guide explains how to preserve existing data. Use the agent's `deploy` tool to publish the app.
