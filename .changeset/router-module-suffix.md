---
"@patchsmith/vite": minor
"@patchsmith/cli": minor
---

Require `.router.ts` for automatically registered backend router modules in `src/functions/`. The CLI scaffolds `greeting.router.ts`, and generated guidance uses the new suffix. Both `.router.ts` and legacy `.fn.ts` modules remain blocked from browser bundles.

This is a breaking change: rename existing `.fn.ts` modules to `.router.ts`, update their imports, and run `patchsmith generate` to refresh bindings. Only `src/functions/**/*.router.ts` files register backend functions; `.fn.ts` files are no longer discovered. The `functions/` directory and API namespaces stay the same.
