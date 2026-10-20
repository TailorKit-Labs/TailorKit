# @patchsmith/vite

## 0.1.0-beta.53

### Minor Changes

- e96dce2: Rename TailorKit to Patchsmith. Install `patchsmith` and `@patchsmith/*` packages, replace `TailorKit`/`tailorkit` identifiers with `Patchsmith`/`patchsmith`, and use the `patchsmith` CLI. Rename `tailorkit.config.ts` to `patchsmith.config.ts`, regenerate app bindings with `patchsmith generate`, and update imports to `#patchsmith` and `src/patchsmith.gen.ts`.

  Move platform URLs to `https://patchsmith.io` and host integration routes to `/api/patchsmith`. Rename `TAILORKIT_*` environment variables to `PATCHSMITH_*`; app output and local credential directories now use `.patchsmith`. Sign in again after upgrading. Hosted app assets and RPC URLs continue to use `tailorkit.app`.

- 1912070: Build packages with Vite+ instead of tsup while preserving public entry points and declaration paths.

  Drop Node.js 20 support and target Node.js 22 for all public packages, including the CLI and sandbox library. Use Node.js 22 or newer. Public package manifests and generated apps declare `engines.node: ">=22"`. Internal builds and workspace manifests require Node.js 24.

### Patch Changes

- d799743: Update package repository links to `patchsmith-io/patchsmith`.
- Updated dependencies [d799743]
- Updated dependencies [e96dce2]
- Updated dependencies [1912070]
  - @patchsmith/app@0.1.0-beta.53

## 0.1.0-beta.52

### Patch Changes

- Updated dependencies [1fa87fe]
  - @patchsmith/app@0.1.0-beta.52

## 0.1.0-beta.51

### Patch Changes

- Updated dependencies [38e1ced]
  - @patchsmith/app@0.1.0-beta.51

## 0.1.0-beta.50

### Patch Changes

- Updated dependencies [71fc3a7]
  - @patchsmith/app@0.1.0-beta.50

## 0.1.0-beta.49

### Patch Changes

- 354c1fc: Expose the config app-ID updater at `@patchsmith/vite/config/app-link` so the fx deploy tool can persist the existing app identity before verification and publication, using the same config editing logic as the CLI.
- 127b09e: Include the configured app ID in build upload manifests so host deployment tools can use the app identity from patchsmith.config.ts.
- @patchsmith/app@0.1.0-beta.49

## 0.1.0-beta.48

### Patch Changes

- Updated dependencies [6a5c17a]
  - @patchsmith/app@0.1.0-beta.48

## 0.1.0-beta.47

### Patch Changes

- @patchsmith/app@0.1.0-beta.47

## 0.1.0-beta.46

### Patch Changes

- 20947c7: Move the app database API into the new `@patchsmith/app-db` package, exposed through `patchsmith/db`. Import `defineDatabase`, table and column builders, query helpers, and database types from `patchsmith/db` instead of `patchsmith/server`.

  Use Patchsmith's `defineRelations` from `patchsmith/db` instead of importing it directly from `drizzle-orm`. New apps scaffold these imports automatically. Existing relation callbacks keep the same typed one/many navigation syntax.

- Updated dependencies [20947c7]
  - @patchsmith/app@0.1.0-beta.46

## 0.1.0-beta.45

### Minor Changes

- cc1631f: Require `name` and `slug` in `PatchsmithConfig` and validate both when loading app configuration. Add a nonblank display name and a slug containing 3–32 lowercase letters or digits separated by single hyphens to existing `patchsmith.config.ts` files. Deployment uses the configured slug when creating an app; existing linked apps keep their permanent slug. New app scaffolds include both fields using the package name, appending `-app` when the derived slug is shorter than three characters.

### Patch Changes

- @patchsmith/app@0.1.0-beta.45

## 0.1.0-beta.44

### Patch Changes

- Restore the 0.x beta release line after the accidental 1.0.0-beta.44 release. This release includes the app slug and validation changes from that release; use 0.1.0-beta.44 instead of 1.0.0-beta.44.
- 1fb0155: Use Valibot for internal validation to reduce Patchsmith bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies
- Updated dependencies [1fb0155]
  - @patchsmith/app@0.1.0-beta.44

## 1.0.0-beta.44

### Patch Changes

- 1fb0155: Use Valibot for internal validation to reduce Patchsmith bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies [1fb0155]
  - @patchsmith/app@1.0.0-beta.44

## 0.1.0-beta.43

### Patch Changes

- @patchsmith/app@0.1.0-beta.43

## 0.1.0-beta.42

### Patch Changes

- c54e0b1: Remove Patchsmith app previews, including the `patchsmith preview` command, host preview consent and configuration, platform preview APIs and schemas, client preview metadata and stores, live revision subscriptions, and sandbox inline-source loading. Use deployed app builds for host integrations.
- @patchsmith/app@0.1.0-beta.42

## 0.1.0-beta.41

### Patch Changes

- @patchsmith/app@0.1.0-beta.41

## 0.1.0-beta.40

### Minor Changes

- 677501e: Add optional `name` and `description` fields to `PatchsmithConfig`. Deployment uses them for new apps and synchronizes configured fields on existing apps. Omitted fields preserve existing values; new apps fall back to the package or directory name and have no description. Set `description: null` to clear it.

### Patch Changes

- @patchsmith/app@0.1.0-beta.40

## 0.1.0-beta.39

### Patch Changes

- @patchsmith/app@0.1.0-beta.39

## 0.1.0-beta.38

### Patch Changes

- @patchsmith/app@0.1.0-beta.38

## 0.1.0-beta.37

### Patch Changes

- f2da040: Export upload manifest validation separately from the Vite builder so server runtimes can validate deployment artifacts without loading the compiler or its native bindings.
- Updated dependencies [0d72562]
  - @patchsmith/app@0.1.0-beta.37

## 0.1.0-beta.36

### Patch Changes

- @patchsmith/app@0.1.0-beta.36

## 0.1.0-beta.35

### Patch Changes

- @patchsmith/app@0.1.0-beta.35

## 0.1.0-beta.34

### Patch Changes

- @patchsmith/app@0.1.0-beta.34

## 0.1.0-beta.33

### Patch Changes

- @patchsmith/app@0.1.0-beta.33

## 0.1.0-beta.32

### Patch Changes

- @patchsmith/app@0.1.0-beta.32

## 0.1.0-beta.31

### Patch Changes

- 4d2f904: Align source code with Ultracite’s default Oxlint and Oxfmt presets while preserving public APIs and runtime lifecycle behavior.
- Updated dependencies [4d2f904]
  - @patchsmith/app@0.1.0-beta.31

## 0.1.0-beta.30

### Minor Changes

- 29f3e30: Move the complete build pipeline and configuration loading into `@patchsmith/vite`. Build Patchsmith apps with the public `patchsmith()` plugin from `patchsmith/vite`. Init now offers Vite+ (recommended, with linting, formatting and testing) or Vite (build only), with one `vite.config.ts` for app tooling. Deploy builds using the app's Vite configuration and installation.

  Remove `patchsmith build`, `buildApp()`, the init lint/format flags, and build settings in `patchsmith.config.ts`. Set `build.outDir` in `vite.config.ts` instead.

### Patch Changes

- Updated dependencies [f8dce5d]
- Updated dependencies [29f3e30]
  - @patchsmith/app@0.1.0-beta.30
