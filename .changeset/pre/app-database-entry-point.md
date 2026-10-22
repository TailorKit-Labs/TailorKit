---
"patchsmith": minor
"@patchsmith/app": minor
"@patchsmith/app-db": minor
"@patchsmith/cli": patch
"@patchsmith/vite": patch
---

Move the app database API into the new `@tailorkit/app-db` package, exposed through `tailorkit/db`. Import `defineDatabase`, table and column builders, query helpers, and database types from `tailorkit/db` instead of `tailorkit/server`.

Use TailorKit's `defineRelations` from `tailorkit/db` instead of importing it directly from `drizzle-orm`. New apps scaffold these imports automatically. Existing relation callbacks keep the same typed one/many navigation syntax.
