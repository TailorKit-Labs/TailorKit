# Set up the app

Inspect the existing app first. Keep its package manager, scripts, identity, and working configuration. For choosing between product tools, app storage, and local state, see the [workflow guide](references/workflows.md).

## Empty workspace

After confirming `/workspace/app` has no source to preserve:

```sh
pnpm dlx tailorkit@beta init /workspace --name app --host '<supplied-host-url>' --package-manager pnpm --tooling vite-plus --force --no-install
cd /workspace/app
pnpm install
```

Quote the supplied URL as one argument. Add `--schema <supplied-schema-path>` to init and generate when a schema was supplied; preserve that file. Otherwise generation fetches the configured product contract.

Keep the scaffold's dependency policy: three days for third-party releases, with only `tailorkit` and `@tailorkit/*` exempt. Keep esbuild's allowed install script for Drizzle Kit. Retain the SDK version chosen by the CLI.

## Configuration and generation

Keep `tailorkit.config.ts` identity fields and the TailorKit/Preact Vite plugins. Enable `server: {}` for functions or repeated-slot resolvers. Defaults are `src/server.ts` and `src/db/migrations`; inspect configured paths in existing apps.

Run the app's `generate` script after product contract or backend registration changes. Generated bindings and the capabilities skill describe available components, tools, slots, and context. Correct source/configuration and regenerate to resolve mismatches.

Use public imports: `tailorkit/client`, `tailorkit/server`, `tailorkit/db`, and `tailorkit/vite`. For an unfamiliar API, inspect its installed public declarations. With pnpm, resolve backing packages through the public entry point:

```sh
node --input-type=module -e 'import { findPackageJSON } from "node:module"; import { dirname, join } from "node:path"; console.log(join(dirname(findPackageJSON("@tailorkit/app-db", import.meta.resolve("tailorkit/db"))), "dist"));'
```

Read only the declarations needed. App imports still use `tailorkit/db`.

## Checks and publication

Run existing formatting/lint commands and relevant tests. Use `deploy` for the typecheck, build, and publication. For failures, check the reported view, registration, plugin configuration, or migration drift. Generate missing migrations rather than resetting data or disabling validation. A TailorKit app needs no separate server deployment.
