# @patchsmith/app-db

## 0.1.0-beta.52

No changes in this release.

## 0.1.0-beta.51

No changes in this release.

## 0.1.0-beta.50

No changes in this release.

## 0.1.0-beta.49

No changes in this release.

## 0.1.0-beta.48

No changes in this release.

## 0.1.0-beta.47

No changes in this release.

## 0.1.0-beta.46

### Minor Changes

- 20947c7: Move the app database API into the new `@patchsmith/app-db` package, exposed through `patchsmith/db`. Import `defineDatabase`, table and column builders, query helpers, and database types from `patchsmith/db` instead of `patchsmith/server`.

  Use Patchsmith's `defineRelations` from `patchsmith/db` instead of importing it directly from `drizzle-orm`. New apps scaffold these imports automatically. Existing relation callbacks keep the same typed one/many navigation syntax.
