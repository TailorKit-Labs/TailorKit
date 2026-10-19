# Place UI in the host

A slot is a host UI location, such as a sidebar, panel, or page. A view is your component for a supported context path in that slot. Context is host-supplied data, such as the selected record. Read the generated views page for available slots, paths, and context fields. Use only the surfaces the requested feature needs.

## View files

Views live in `src/slots/<slot>/**/*.view.tsx`. The first directory names the slot literally, including any dots. The remaining directories and filename determine the context path:

| View file | Slot | Context path |
| --- | --- | --- |
| `src/slots/page/index.view.tsx` | `page` | `/` |
| `src/slots/panel/members.view.tsx` | `panel` | `/members` |
| `src/slots/panel/members/index.view.tsx` | `panel` | `/members` |
| `src/slots/panel/members.detail.view.tsx` | `panel` | `/members/detail` |
| `src/slots/panel/members/detail.view.tsx` | `panel` | `/members/detail` |
| `src/slots/panel/some.new.new.view.tsx` or `src/slots/panel/some/new/new/index.view.tsx` | `panel` | `/some/new/new` |

Dots and directories both separate path segments and can be mixed. A final `index` is omitted; segments must be nonempty. Choose one filename per slot/path pair. The alternative spellings above describe the same view.

Default-export `defineView` from `tailorkit/client` with an inline options object and named properties. Omitted `slot` and `view` come from the file location. Explicit values must be matching string literals; an explicit `view` gives precise context typing. Import `#tailorkit` for the host types.

## Selected-record and page data

Paths describe host context, not browser URLs. The host chooses the deepest matching view, falling back to ancestors. Read its data with the definition's `useContext()` inside the view component tree. Ancestor shells do not have that view's context.

For a host `panel` at `/records/detail` with `context.recordId`, read the selected record inside the view. The return type lets the component refer to its definition:

<!-- example: src/slots/panel/records.detail.view.tsx -->

```tsx
import type { ComponentChildren } from "preact";
import { defineView } from "tailorkit/client";

import { Box } from "#tailorkit";

const Detail = (): ComponentChildren => {
  const { recordId } = definition.useContext();
  return <Box>Selected record: {recordId}</Box>;
};
const definition = defineView({
  slot: "panel",
  view: "/records/detail",
  component: Detail,
});
export default definition;
```

## Shared shells and layouts

A shell wraps UI with shared controls or providers. These files are optional:

| File | Wraps |
| --- | --- |
| `src/root.tsx` | App UI across slots |
| `src/slots/panel/root.tsx` | The `panel` slot |
| `src/slots/panel/layout.tsx` | All views in `panel` |
| `src/slots/panel/members.layout.tsx` or `src/slots/panel/members/layout.tsx` | `/members` and its descendants in `panel` |

Roots default-export `defineRoute({ shellComponent: Shell })`. A slot root sits directly in its slot directory. Layouts default-export a component or `defineRoute({ shellComponent: Layout })`. `layout.tsx` uses its directory path; `*.layout.tsx` adds filename segments. Layout paths retain `index`, so `index.layout.tsx` wraps `/index`. Each layout path is unique within its slot.

Render `<Route />` inside shells/layouts for the next child. Nesting is app root → slot root → matching layouts from shallowest to deepest → selected view. Layouts match whole path segments: `/members` includes `/members/detail`, not `/membership`. Shared shells/layouts retain local state as views change. Keep `ClientProvider` above backend hooks.

The scaffold's `src/root.tsx` wraps the selected view with the backend hook provider:

<!-- example: src/root.tsx -->

```tsx
import { ClientProvider, defineRoute, Route } from "tailorkit/client";

const Shell = () => (
  <ClientProvider>
    <Route />
  </ClientProvider>
);
export default defineRoute({ shellComponent: Shell });
```

## One view per item

A slot with `multiple: true` displays separate instances of a view, such as one tile per record. Each instance has a stable unique `key`, host-supported `metadata` for labels/placement, and `data` for the component.

Enable `server: {}` and declare `instances: { dataSchema, resolve: (...) => ... }` in a module-level `defineView`. Use an inline arrow/function expression for `resolve`; the path is inferred or a matching literal. `dataSchema` validates each item's data. Single-instance slots omit `instances`.

The resolver runs on the backend with `{ context, identity, signal, queries }`. Read saved records through registered queries and enforce access there. Return the instances; read the selected item's data with `definition.useInstance()` inside the view. Keep resolver dependencies backend-safe. Instance lists refresh through the host separately from query subscriptions.

For a repeated `tile` slot at `/`, return one tile per shared note. Use the host's actual slots and metadata fields; `notes.list` comes from the functions skill:

<!-- example: src/slots/tile/index.view.tsx -->

```tsx
import type { ComponentChildren } from "preact";
import { defineView } from "tailorkit/client";
import * as v from "valibot";

import { Box } from "#tailorkit";

const definition = defineView({
  slot: "tile",
  view: "/",
  component: (): ComponentChildren => {
    const { data } = definition.useInstance();
    return <Box>{data.title}</Box>;
  },
  instances: {
    dataSchema: v.object({ title: v.string() }),
    resolve: async ({ queries }) =>
      (await queries.notes.list()).map(({ id, title }) => ({
        key: id,
        metadata: {},
        data: { title },
      })),
  },
});
export default definition;
```
