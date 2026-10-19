# Views and context

Choose a supported slot/path from the generated capabilities. Implement only surfaces needed by the requested workflow; a slot's availability does not require a view. Use multiple instances only when the product surface needs separate items. The [view examples](references/views.md) cover a shell, record context, and repeated tiles.

Put views in `src/slots/<slot>/**/*.view.tsx`, default-exporting `defineView` from `tailorkit/client`. `members.detail.view.tsx` maps to `/members/detail`; `index.view.tsx` maps to `/`. Explicit `slot`/`view` values must match the file location and product contract. Import `#tailorkit` for its type augmentation.

These paths describe product context, not browser routes. The product selects the deepest matching view or falls back to an ancestor. Read context with the definition's `useContext()` inside its component tree. Context belongs to that view, not ancestor shells.

## Shells and layouts

`src/root.tsx` wraps the app; a slot `root.tsx` wraps that slot. Export `defineRoute({ shellComponent: Shell })` and render `<Route />` to continue the tree. Keep `ClientProvider` above backend hooks. Add layouts only for UI shared by the current views: `layout.tsx` wraps its directory, and `members.layout.tsx` wraps `/members` and descendants.

## Repeated instances

For `multiple: true` slots, enable `server: {}` and supply inline `instances: { dataSchema, resolve: (...) => ... }` on a module-level `defineView` with a literal path. Single slots omit `instances`.

The build extracts the inline resolver into the backend. It receives `{ context, identity, signal, queries }` and can await registered queries, not mutations/actions. Use backend-safe dependencies and enforce access through those queries. Return stable unique keys, product-supported `metadata`, and data matching `dataSchema`. Read instance data with `useInstance()` inside the view.

Instance discovery is separate from reactive query updates. Check how the product refreshes instances when that behavior matters to the feature.
