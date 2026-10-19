# Views and context

Choose a supported slot/path from the generated capabilities. Implement only surfaces needed by the requested workflow; a slot's availability does not require a view. Use multiple instances only when the product surface needs separate items. The [view examples](references/views.md) cover a shell, record context, and repeated tiles.

## File-based routing

The build discovers views from `src/slots/<slot>/**/*.view.tsx`. The directory immediately under `src/slots/` names the slot; the remaining directories and filename define the context path. Only files matching this pattern register views. A `defineView` call configures a discovered view; it does not register its file by itself.

| Slot | Context path | View file |
| --- | --- | --- |
| `page` | `/` | `src/slots/page/index.view.tsx` |
| `panel` | `/members` | `src/slots/panel/members.view.tsx` |
| `panel` | `/members/detail` | `src/slots/panel/members.detail.view.tsx` or `src/slots/panel/members/detail.view.tsx` |

Dots and directories separate path segments. A final `index` maps to its parent: `members/index.view.tsx` maps to `/members`. Each slot/path pair has one view file and must be supported by the product contract. Other files can hold components imported by views.

View files default-export `defineView` from `tailorkit/client`. The build infers omitted `slot` and `view` values from the file location; explicit values must agree. Import `#tailorkit` for its type augmentation. For repeated slots, the definition also supplies the instance configuration described below.

## Context

These paths describe product context, not browser routes. The product selects the deepest matching view or falls back to an ancestor. Read context with the definition's `useContext()` inside its component tree. Context belongs to that view, not ancestor shells.

## Shells and layouts

`src/root.tsx` wraps the app; a slot `root.tsx` wraps that slot. Export `defineRoute({ shellComponent: Shell })` and render `<Route />` to continue the tree. Keep `ClientProvider` above backend hooks. Add layouts only for UI shared by the current views: `layout.tsx` wraps its directory, and `members.layout.tsx` wraps `/members` and descendants.

## Repeated instances

For `multiple: true` slots, enable `server: {}` and supply inline `instances: { dataSchema, resolve: (...) => ... }` on a module-level `defineView` with a literal path. Single slots omit `instances`.

The build extracts the inline resolver into the backend. It receives `{ context, identity, signal, queries }` and can await registered queries, not mutations/actions. Use backend-safe dependencies and enforce access through those queries. Return stable unique keys, product-supported `metadata`, and data matching `dataSchema`. Read instance data with `useInstance()` inside the view.

Instance discovery is separate from reactive query updates. Check how the product refreshes instances when that behavior matters to the feature.
