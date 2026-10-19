# Views and context

Choose a supported slot/path from the generated capabilities. Implement only surfaces needed by the requested workflow; a slot's availability does not require a view. Use multiple instances only when the product surface needs separate items. The [view examples](references/views.md) cover a shell, record context, and repeated tiles.

## Register each view

1. Choose a supported slot and context path for each requested UI surface. Map each pair to a file under `src/slots/<slot>/` ending in `.view.tsx`:

   | Slot | Context path | View file |
   | --- | --- | --- |
   | `page` | `/` | `src/slots/page/index.view.tsx` |
   | `panel` | `/members` | `src/slots/panel/members.view.tsx` |
   | `panel` | `/members/detail` | `src/slots/panel/members.detail.view.tsx` or `src/slots/panel/members/detail.view.tsx` |

   Use pairs supported by the actual contract. Dots and directories separate path segments; a final `index` maps to its parent.

2. Default-export `defineView` from `tailorkit/client`. Explicit `slot`/`view` values must match the file location and product contract. Import `#tailorkit` for its type augmentation. For repeated slots, follow the instance requirements below.
3. **Registration check, before deploy:** list the view files and account for every intended slot/path pair with exactly one matching file and default export. File discovery registers views; a `defineView` call alone does not. Files outside `src/slots/` or without the `.view.tsx` suffix are ignored, so typechecks and builds can pass while the app has no views. Move misplaced views to their matching files before publishing.
4. **Build manifest, after deploy:** read `views` in the generated `tailorkit-upload.json` (the default path is `.tailorkit/tailorkit-upload.json`; use the configured build output if changed). Every intended slot/path pair must be present, with `instances: true` for repeated views. Missing pairs or `views: []` in a UI app require a registration repair and redeployment before reporting completion. Inspect the deploy tool's existing output rather than running a separate build.

## Context

These paths describe product context, not browser routes. The product selects the deepest matching view or falls back to an ancestor. Read context with the definition's `useContext()` inside its component tree. Context belongs to that view, not ancestor shells.

## Shells and layouts

`src/root.tsx` wraps the app; a slot `root.tsx` wraps that slot. Export `defineRoute({ shellComponent: Shell })` and render `<Route />` to continue the tree. Keep `ClientProvider` above backend hooks. Add layouts only for UI shared by the current views: `layout.tsx` wraps its directory, and `members.layout.tsx` wraps `/members` and descendants.

## Repeated instances

For `multiple: true` slots, enable `server: {}` and supply inline `instances: { dataSchema, resolve: (...) => ... }` on a module-level `defineView` with a literal path. Single slots omit `instances`.

The build extracts the inline resolver into the backend. It receives `{ context, identity, signal, queries }` and can await registered queries, not mutations/actions. Use backend-safe dependencies and enforce access through those queries. Return stable unique keys, product-supported `metadata`, and data matching `dataSchema`. Read instance data with `useInstance()` inside the view.

Instance discovery is separate from reactive query updates. Check how the product refreshes instances when that behavior matters to the feature.
