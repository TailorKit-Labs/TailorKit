---
"@patchsmith/app": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Move the complete build pipeline and configuration loading into `@patchsmith/vite`. Build Patchsmith apps with the public `patchsmith()` plugin from `patchsmith/vite`. Init now offers Vite+ (recommended, with linting, formatting and testing) or Vite (build only), with one `vite.config.ts` for app tooling. Deploy builds using the app's Vite configuration and installation.

Remove `patchsmith build`, `buildApp()`, the init lint/format flags, and build settings in `patchsmith.config.ts`. Set `build.outDir` in `vite.config.ts` instead.
