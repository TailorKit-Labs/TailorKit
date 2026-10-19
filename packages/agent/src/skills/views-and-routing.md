# Views and file routing

A slot is a named host UI surface. A view supplies an app's UI for one supported context path in that slot. Paths describe host context, not browser URLs; the host selects the deepest matching view and falls back through its ancestors. Without a match, the app renders nothing in that slot.

- Put views in `src/slots/<slot>/**/*.view.tsx`. Default-export `defineView({ view, component })` from `tailorkit/client`, using an inline options object. The build infers the slot from the directory; an explicit `slot` must agree.
- Dots and directories separate path segments: `members.detail.view.tsx` and `members/detail.view.tsx` map to `/members/detail`. A final `index` is omitted: `index.view.tsx` → `/`, `members/index.view.tsx` → `/members`. An explicit `view` must match and gives precise context typing. Mismatched declarations fail the build; move the file to change its path. Each slot/path pair must be unique and supported by the contract.
- `src/root.tsx` wraps the app; `src/slots/<slot>/root.tsx` wraps that slot. Both default-export `defineRoute({ shellComponent: Shell })`. Shells render `<Route />` from `tailorkit/client` to continue the tree. Keep the app's `ClientProvider` around this outlet when using backend hooks.
- `layout.tsx` wraps its directory path; `members.layout.tsx` wraps `/members` and its descendants. Layouts default-export a component or `defineRoute({ shellComponent })` and render `<Route />`. Nesting is app root → slot root → matching layouts → view. Shared shells and layouts persist across view changes.
- Read typed page/record data with `view.useContext()` from the registered definition. Ancestor context fields are included; fallback views receive only their own and ancestor fields. Use the supplied context rather than parsing location or reaching into the host.
- `view.useContext()` and `view.useInstance()` are available inside that view's component tree, not its ancestor shells/layouts. Import `#tailorkit` in view modules even when no generated values are needed (a side-effect import works); it supplies the slot/context type augmentation.
- For slots declared `multiple: true`, provide an inline `instances: { dataSchema, resolve: (...) => ... }` in a module-level `defineView` with a literal `view` path. Use an inline arrow/function expression, not method shorthand or an imported resolver. The build extracts it into the backend; it cannot capture the view definition, hooks, or browser state.
- The resolver receives `{ context, identity, signal, queries }` and can await registered queries, but no mutations or actions. Return stable, unique, non-empty `key`s, host-compatible `metadata`, and schema-valid `data`. Enable `server: {}` for these resolvers too.
- Read the selected instance with `view.useInstance()`. Metadata supplies host labels or placement hints; data supplies rendered values. Metadata does not create browser routes or position UI by itself. Single-instance slots omit `instances`.

For example, a repeated `tile` slot supporting `/` can use this shape, with metadata fields taken from that host's contract:

```tsx
// src/slots/tile/index.view.tsx
import "#tailorkit";
import type { ComponentChildren } from "preact";
import { defineView } from "tailorkit/client";
import * as v from "valibot";

const Tile = (): ComponentChildren => {
  const { data } = view.useInstance();
  return <>{data.title}</>;
};

const view = defineView({
  view: "/",
  instances: {
    dataSchema: v.object({ title: v.string() }),
    resolve: () => [
      { key: "overview", metadata: {}, data: { title: "Overview" } },
    ],
  },
  component: Tile,
});

export default view;
```

Use a generated host component to style the content. For a single-instance view, omit `instances` and read host data with `view.useContext()`. Match the slot/path and metadata to the generated contract; filenames do not create new host routes.

Instance discovery and reactive query updates are separate flows. Confirm how the product refreshes instances after records are created or removed; a committed mutation does not by itself promise new product tiles. Prefer one reactive list view when the slot's discovery behavior cannot provide the requested live updates.
