---
"@patchsmith/app": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Register app backend routers automatically from `src/functions/**/*.fn.ts`, replacing the app's `server.ts` entry and `server.entry` configuration. Dots and directories create equivalent namespaces, nested router objects remain supported, and shared namespaces merge. Duplicate functions and function/namespace conflicts fail builds with their API path and source files. Watch builds refresh registrations and generated type-only API bindings as modules change.

Reject `name` and `then` in every function and namespace segment because those names conflict with client reference properties. The manual `defineServer` composition API is removed; backend registration is owned by file discovery.
