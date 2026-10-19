# Record context, shells, and repeated instances

These examples assume a single `panel` slot supports `/records/detail` with `context.recordId: string`, and a repeated `tile` slot supports `/`. Choose the actual slot/path from the generated capabilities. A different filename cannot create an unsupported product page.

## Keep the provider stable

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

## Read context inside the selected view

Annotating the component's return type permits its hook to refer to the module-level definition declared below. Context is available to descendants of this view, not the app shell. Pass record identifiers into backend functions only with the required backend authorization.

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

## Resolve a bounded, authorized set of tiles

Enable `server: {}` and register the notes query from the functions recipe. The inline resolver runs on the backend; the query enforces ownership. Stable record IDs preserve instance identity. The data schema limits what is sent to the UI. Empty metadata is valid for this example; adapt labels/placement only to the product's supported metadata.

<!-- example: src/slots/tile/index.view.tsx -->

```tsx
import type { ComponentChildren } from "preact";
import { defineView } from "tailorkit/client";
import { z } from "zod";

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
    dataSchema: z.object({ title: z.string() }),
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

The resolver's captured imports must be backend-safe. It receives no mutation/action capability and cannot read component state. Instance discovery is separate from a view's reactive query subscription; do not assume a mutation automatically adds/removes product tiles. Verify the product's instance refresh behavior, and use a single list view when live collection updates are the intended behavior.
