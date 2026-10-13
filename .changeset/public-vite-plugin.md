---
"@tailorkit/app": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Build TailorKit apps with the public `tailorkit()` plugin from `tailorkit/vite`.
Init now offers Vite+ (recommended, with linting, formatting and testing) or Vite
(build only), with one `vite.config.ts` for app tooling. Deploy builds using the
app's Vite configuration and installation.

Remove `tailorkit build`, `buildApp()`, the init lint/format flags, and build
settings in `tailorkit.config.ts`. Set `build.outDir` in `vite.config.ts` instead.
