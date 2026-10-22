---
"@patchsmith/app": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Add `createFunctions({ database })` to bind database types and relations once for all query and mutation handlers. Add `defineRouter` for explicit function module exports composed in `defineServer`.

Remove per-function `.database(...)` builders and the `database` option on standalone query/mutation definitions. Configure `createFunctions({ database })` once in the shared database module and import its `fn` in function modules.

New apps scaffold the shared `fn`, default router exports, and a namespaced greeting at `api.greeting.getGreeting`. Export each function module with `export default defineRouter({ ... })` and import its default router in the server entry point.
