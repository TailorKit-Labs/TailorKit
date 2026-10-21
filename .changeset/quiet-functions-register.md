---
"@patchsmith/app": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Register app backend routers automatically from `src/functions/**/*.fn.ts`, replacing the app's `server.ts` entry and `server.entry` configuration. Dots and directories create equivalent namespaces, nested router objects remain supported, and shared namespaces merge. Duplicate functions and function/namespace conflicts fail builds with their API path and source files. Watch builds refresh registrations and generated type-only API bindings as modules change.

To migrate, enable `server: {}`, move each registered router to a `.fn.ts` path matching its previous API namespace, remove `server.entry` and the app's `server.ts`, then run `patchsmith generate`. Keep action dependencies explicit with `.functions(...)`.

Reject `name` and `then` in every function and namespace segment because those names conflict with client reference properties. Rename existing conflicting router keys before regenerating.
