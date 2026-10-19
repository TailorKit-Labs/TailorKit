# Display a record or repeated items

These examples assume a `panel` slot at `/records/detail` with `context.recordId: string`, and a repeated `tile` slot at `/`. Use the slot names, paths, context, and components in the host's generated views page.

## App shell

The scaffold's root supplies `ClientProvider` for backend hooks. `<Route />` renders the selected view or layout:

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

## Show the selected record

Read the host's record ID with `definition.useContext()` inside the view. The return type lets this component refer to its definition below:

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

## Show one tile per note

For a slot with `multiple: true`, return one instance per note. Enable `server: {}` and register the backend example's `notes.list` query. It returns authorized notes; their IDs identify each tile. Use the host's supported metadata fields:

<!-- example: src/slots/tile/index.view.tsx -->

```tsx
import type { ComponentChildren } from "preact";
import { defineView } from "tailorkit/client";
import * as v from "valibot";

import { Box } from "#tailorkit";

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

For a list inside one panel, use one view with `useQuery` instead of repeated instances.
