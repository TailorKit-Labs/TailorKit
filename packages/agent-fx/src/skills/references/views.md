# View examples

Choose the example needed. These assume a `panel` at `/records/detail` with `context.recordId: string`, and a repeated `tile` at `/`; use the actual product capabilities.

## Shell for backend hooks

<!-- example: src/root.tsx -->

```tsx
import { ClientProvider, defineRoute, Route } from "patchsmith/client";

const Shell = () => (
  <ClientProvider>
    <Route />
  </ClientProvider>
);
export default defineRoute({ shellComponent: Shell });
```

## Read context inside the selected view

Read context inside the view. The explicit return type allows the component to refer to its definition below.

<!-- example: src/slots/panel/records.detail.view.tsx -->

```tsx
import { defineView } from "patchsmith/client";
import type { ComponentChildren } from "preact";

import { Box } from "#patchsmith";

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

## Repeated tiles

Only use this for a multiple-instance slot. Enable `server: {}` and register the notes query from the functions example. The query enforces access; record IDs supply stable keys. Use product-supported metadata.

<!-- example: src/slots/tile/index.view.tsx -->

```tsx
import { defineView } from "patchsmith/client";
import type { ComponentChildren } from "preact";
import * as v from "valibot";

import { Box } from "#patchsmith";

const Tile = (): ComponentChildren => {
  const { data } = definition.useInstance();
  return <Box>{data.title}</Box>;
};

const definition = defineView({
  slot: "tile",
  view: "/",
  component: Tile,
  instances: {
    dataSchema: v.object({ title: v.string() }),
    resolve: async ({ queries }) => {
      const rows = await queries.notes.list();
      return rows.map((note) => ({
        key: note.id,
        metadata: {},
        data: { title: note.title },
      }));
    },
  },
});
export default definition;
```

For a normal reactive list, keep one view and use `useQuery` instead.
