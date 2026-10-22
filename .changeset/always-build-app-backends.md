---
"@patchsmith/vite": minor
"@patchsmith/cli": minor
---

Always build and deploy a private backend for every app, including apps with no functions. Function discovery, generated API bindings, view instance resolvers, and database migration generation now work without `server: {}` in `patchsmith.config.ts`.

The optional `server` field continues to configure settings such as a custom migrations path. Apps that previously omitted it now include a backend automatically; existing empty `server: {}` settings can be removed.
