# @tailorkit/app-db

## 0.1.0-beta.48

No changes in this release.

## 0.1.0-beta.47

No changes in this release.

## 0.1.0-beta.46

### Minor Changes

- 20947c7: Move the app database API into the new `@tailorkit/app-db` package, exposed through `tailorkit/db`. Import `defineDatabase`, table and column builders, query helpers, and database types from `tailorkit/db` instead of `tailorkit/server`.

  Use TailorKit's `defineRelations` from `tailorkit/db` instead of importing it directly from `drizzle-orm`. New apps scaffold these imports automatically. Existing relation callbacks keep the same typed one/many navigation syntax.
