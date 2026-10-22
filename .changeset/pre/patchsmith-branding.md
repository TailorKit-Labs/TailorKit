---
"patchsmith": minor
"@patchsmith/ai-sdk": minor
"@patchsmith/app": minor
"@patchsmith/app-db": minor
"@patchsmith/cli": minor
"@patchsmith/client-core": minor
"@patchsmith/client-platform": minor
"@patchsmith/core": minor
"@patchsmith/react": minor
"@patchsmith/sandbox": minor
"@patchsmith/vite": minor
---

Rename TailorKit to Patchsmith. Install `patchsmith` and `@patchsmith/*` packages, replace `TailorKit`/`tailorkit` identifiers with `Patchsmith`/`patchsmith`, and use the `patchsmith` CLI. Rename `tailorkit.config.ts` to `patchsmith.config.ts`, regenerate app bindings with `patchsmith generate`, and update imports to `#patchsmith` and `src/patchsmith.gen.ts`.

Move platform URLs to `https://patchsmith.io` and host integration routes to `/api/patchsmith`. Rename `TAILORKIT_*` environment variables to `PATCHSMITH_*`; app output and local credential directories now use `.patchsmith`. Sign in again after upgrading. Hosted app assets and RPC URLs continue to use `tailorkit.app`.
