# @tailorkit/vite

## 0.1.0-beta.31

### Patch Changes

- 4d2f904: Align source code with Ultracite’s default Oxlint and Oxfmt presets while preserving public APIs and runtime lifecycle behavior.
- Updated dependencies [4d2f904]
  - @tailorkit/app@0.1.0-beta.31

## 0.1.0-beta.30

### Minor Changes

- 29f3e30: Move the complete build pipeline and configuration loading into `@tailorkit/vite`. Build TailorKit apps with the public `tailorkit()` plugin from `tailorkit/vite`. Init now offers Vite+ (recommended, with linting, formatting and testing) or Vite (build only), with one `vite.config.ts` for app tooling. Deploy builds using the app's Vite configuration and installation.

  Remove `tailorkit build`, `buildApp()`, the init lint/format flags, and build settings in `tailorkit.config.ts`. Set `build.outDir` in `vite.config.ts` instead.

### Patch Changes

- Updated dependencies [f8dce5d]
- Updated dependencies [29f3e30]
  - @tailorkit/app@0.1.0-beta.30
