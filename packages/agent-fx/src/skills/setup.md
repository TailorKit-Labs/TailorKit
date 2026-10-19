# Set up the app

Setup runs before the model. `/workspace/app` already has dependencies, generated bindings and capabilities. New apps start with `tailorkit init --bare`: only configuration, tooling, bindings and `src/root.tsx`. Create views, server registration and database files only when the feature needs them. Keep existing app scripts and configuration.

For choosing product tools, app storage or local state, see the [workflow guide](references/workflows.md).

Keep the scaffold's dependency policy: three days for third-party releases, with only `tailorkit` and `@tailorkit/*` exempt. Keep esbuild's allowed install script for Drizzle Kit. Retain the SDK version chosen by the CLI.

## Configuration and generation

Keep the TailorKit/Preact Vite plugins. Enable `server: {}` for functions or repeated-slot resolvers; add `src/server.ts` and database files as needed using the function recipe. Defaults are `src/server.ts` and `src/db/migrations`.

Run `pnpm run generate` after contract or backend registration changes. Pass any supplied `--schema` path; preserve that file. Otherwise generation uses the configured host. Generated bindings and capability pages describe supported components, tools, slots and context.

Use public imports: `tailorkit/client`, `tailorkit/server`, `tailorkit/db`, and `tailorkit/vite`. For an unfamiliar API, inspect its installed public declarations. With pnpm, resolve backing packages through the public entry point:

```sh
node --input-type=module -e 'import { findPackageJSON } from "node:module"; import { dirname, join } from "node:path"; console.log(join(dirname(findPackageJSON("@tailorkit/app-db", import.meta.resolve("tailorkit/db"))), "dist"));'
```

Read only the declarations needed. App imports still use `tailorkit/db`.

## Checks and publication

Run lint, formatting checks and relevant tests, then use `deploy` for typechecking, building and publication through the TailorKit CLI. Repair its reported failure before retrying. Generate missing migrations rather than resetting data or disabling validation. A TailorKit app needs no separate server deployment.
