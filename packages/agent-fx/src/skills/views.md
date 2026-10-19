# Views and context

Choose a supported slot/path from the generated capabilities. Implement only surfaces needed by the requested workflow; a slot's availability does not require a view. Use multiple instances only when the product surface needs separate items. The [view examples](references/views.md) cover a shell, record context, and repeated tiles.

## File-based routing

Views use `src/slots/<slot>/**/*.view.tsx`. The directory immediately under `src/slots/` is the literal slot name, including any dots in that name. The remaining directories and filename define the context path:

| View file | Slot | Context path |
| --- | --- | --- |
| `src/slots/page/index.view.tsx` | `page` | `/` |
| `src/slots/panel/members.view.tsx` | `panel` | `/members` |
| `src/slots/panel/members/index.view.tsx` | `panel` | `/members` |
| `src/slots/panel/members.detail.view.tsx` | `panel` | `/members/detail` |
| `src/slots/panel/members/detail.view.tsx` | `panel` | `/members/detail` |
| `src/slots/panel/some.new.new.view.tsx` or `src/slots/panel/some/new/new/index.view.tsx` | `panel` | `/some/new/new` |

Dots and directories both separate path segments and can be mixed. A final `index` segment is omitted for views; every segment must be nonempty. Each slot/path pair has one view file and must be supported by the product contract. Alternative spellings of the same pair are duplicates, not separate views.

View files default-export `defineView` from `tailorkit/client`, called with an inline options object containing named properties. The build fills omitted `slot` and `view` values from the file location. Explicit values must be matching string literals; an explicit `view` also gives precise context typing. Import `#tailorkit` for its type augmentation. Repeated views also supply the instance configuration below.

## Context

These paths describe product context, not browser routes. The product selects the deepest matching view or falls back to an ancestor. Read context with the definition's `useContext()` inside its component tree. Context belongs to that view, not ancestor shells.

## Shells and layouts

Roots and layouts are optional wrappers around discovered views:

| File | Scope |
| --- | --- |
| `src/root.tsx` | App shell across slots. |
| `src/slots/panel/root.tsx` | Shell for the `panel` slot. |
| `src/slots/panel/layout.tsx` | All views in `panel`. |
| `src/slots/panel/members.layout.tsx` or `src/slots/panel/members/layout.tsx` | `/members` and its descendant views in `panel`. |

App and slot roots default-export `defineRoute({ shellComponent: Shell })`. A slot root belongs directly in its slot directory. Layouts default-export either a component or `defineRoute({ shellComponent: Layout })`; `layout.tsx` uses its directory path, while `*.layout.tsx` adds the filename's dotted segments. Unlike view filenames, layout filenames retain a final `index`: `index.layout.tsx` wraps `/index`. Each layout path is unique within its slot.

Render `<Route />` from `tailorkit/client` inside shells and layouts to render the next child. The nesting order is app root → slot root → matching layouts from shallowest to deepest → selected view. A layout matches the selected view's path or a slash-separated ancestor, so `/members` wraps `/members/detail` but not `/membership`. Common shells and layouts stay mounted as views change, preserving their local state within that mounted app. Keep `ClientProvider` above backend hooks.

## Repeated instances

For `multiple: true` slots, enable `server: {}` and supply inline `instances: { dataSchema, resolve: (...) => ... }` on a module-level `defineView`. Use an inline arrow or function expression for `resolve`. The view path is inferred from the file or supplied as a matching string literal. Single slots omit `instances`.

The build extracts the inline resolver into the backend. It receives `{ context, identity, signal, queries }` and can await registered queries, not mutations/actions. Use backend-safe dependencies and enforce access through those queries. Return stable unique keys, product-supported `metadata`, and data matching `dataSchema`. Read instance data with `useInstance()` inside the view.

Instance discovery is separate from reactive query updates. Check how the product refreshes instances when that behavior matters to the feature.
