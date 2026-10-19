# TailorKit app SDK

Use `@tailorkit/app` to build TailorKit extensions. Apps require Preact 11; install `preact@^11` alongside the SDK.

Define app tables, relations, and database capabilities with `tailorkit/db`, backed by [`@tailorkit/app-db`](../app-db/README.md). Define queries, mutations, and actions with `tailorkit/server`.

## File routing

The builder registers views from `src/slots` automatically. Only files ending in `.view.tsx` register views, so supporting components can live beside them:

```text
src/
  root.tsx
  slots/
    panel/
      root.tsx
      layout.tsx
      index.view.tsx
      customers.view.tsx
      customers.layout.tsx
      customers.details.view.tsx
      customer-card.tsx
```

The slot directory is its literal host slot name, including dots in names such as `panel.links`. Dots in a view filename separate route segments: `customers.details.view.tsx` registers `/customers/details`. Subdirectories also separate segments. `customer-card.tsx` is an ordinary component and is ignored unless imported.

Duplicate view paths in a slot fail the build.

For example, `src/slots/panel/customers.details.view.tsx` registers `/customers/details`:

```tsx
import { defineView } from "tailorkit/client";

import CustomerCard from "./customer-card";

export default defineView({ component: CustomerCard });
```

The builder supplies the slot and route before compiling. In `src/slots/panel/index.view.tsx`, an explicit `view` gives typed host context and must match `/`:

```tsx
import { defineView } from "tailorkit/client";

const view = defineView({ view: "/", component: Home });

function Home() {
  const context = view.useContext();
  return <>Welcome</>;
}

export default view;
```

`index.view.tsx` maps to `/`. A final `index` segment is omitted, so `customers/index.view.tsx` and `customers.index.view.tsx` both map to `/customers`. Other segments stay literal: `index.details.view.tsx` maps to `/index/details`.

An explicit `view` or `slot` must be a matching string literal; mismatches fail the build. Use named properties in the inline `defineView` options so the build can check them.

For multi-instance views, provide `instances: { dataSchema, resolve }`. The builder extracts resolvers into the private server bundle. Host slot/view support and multiplicity are validated when publishing. An explicit slot also retains the source-level TypeScript checks for that slot's supported views and instances.

## Roots and layouts

`src/root.tsx` is the optional app shell. Init generates a shell with the backend provider:

```tsx
import { ClientProvider, defineRoute, Route } from "tailorkit/client";

function Shell() {
  return (
    <ClientProvider>
      <Route />
    </ClientProvider>
  );
}

export default defineRoute({ shellComponent: Shell });
```

Each slot can also have a `root.tsx` exporting `defineRoute({ shellComponent })`. It wraps every view in that slot, inside the app shell. A shell can render its `children` prop instead of `<Route />`.

`layout.tsx` wraps its directory path: at the slot root it wraps the entire slot; `members/layout.tsx` wraps `/members` and its descendants. `customers.layout.tsx` wraps `/customers` and its descendants, with matching at segment boundaries.

Unlike view paths, layout paths retain a final `index` segment: `index.layout.tsx` maps to `/index`, and `members/index.layout.tsx` maps to `/members/index`. Layouts do not register views themselves.

Export a component as the layout’s default export, or use a `defineRoute({ shellComponent })` definition:

```tsx
import { Route } from "tailorkit/client";

export default function CustomersLayout() {
  return <Route />;
}
```

For `/customers/details`, the order is app root → slot root → slot layout → customers layout → details view. Shared shells and layouts stay mounted as the selected view changes; layouts mount and unmount when entering or leaving their route subtree. Layouts do not automatically receive a leaf view's typed context.

Each mounted slot instance has its own shell, provider, and layout state. Two separate host mounts do not share provider state. A provider is disposed when its slot mount is removed.

## Build tooling

Run `tailorkit init` to create an app. Choose **Vite+ (recommended)** for building, linting, formatting, and testing, or **Vite (build only)** for a minimal setup. For non-interactive setup, pass `--tooling vite-plus` or `--tooling vite`.

Build tooling lives in the separate [`@tailorkit/vite`](../vite/README.md) package. Both options generate `vite.config.ts` with the TailorKit plugin. Vite+ apps use:

```ts
import { tailorkit } from "tailorkit/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [tailorkit()]),
  lint: { ignorePatterns: ["src/tailorkit.gen.ts", ".tailorkit/**"] },
  fmt: { ignorePatterns: ["src/tailorkit.gen.ts", ".tailorkit/**"] },
});
```

Vite apps import `defineConfig` from `vite` and use `plugins: [tailorkit()]`. They do not install linting, formatting, or test tooling.

Run your package manager's `build` script to build either setup. Vite+ apps also include `check`, `fix`, `format`, and `test` scripts. A global Vite+ installation is not required.

Add aliases, compile-time constants, and custom Vite plugins to `vite.config.ts`. Custom plugins, aliases, and constants also apply to the private server build. Set `build.outDir` to change the output directory; the default is `.tailorkit`. The plugin owns the client entry and the deployable bundle filenames.

The plugin discovers file routes, extracts private instance resolvers, bundles the backend and migrations, copies logos, and writes `tailorkit-upload.json`. `tailorkit deploy` builds using the same Vite configuration before uploading. Keep host, app ID, logos, and backend settings in `tailorkit.config.ts`.

For builds outside the app's directory, pass `tailorkit({ cwd: appDirectory })`. To use a different TailorKit configuration file, pass `configPath` to the plugin.

File routing is the app client entry point. Generated entries live in the build output and are cleaned up after builds or when a build watcher closes.

## Backend function routers

Bind your database once in `src/db/index.ts`:

```ts
import { defineDatabase } from "tailorkit/db";
import { createFunctions } from "tailorkit/server";

import { relations } from "./relations";

export const db = defineDatabase({ relations });
export const fn = createFunctions({ database: db });
```

Each function file exports its public router. Handlers receive the scoped database automatically, with read-only access in queries and write access in mutations:

```ts
// src/functions/tasks.ts
import { defineRouter } from "tailorkit/server";

import { fn } from "#db";

const listTasks = fn.query.handler(({ db }) =>
  db.query.tasks.findMany().sync()
);

export default defineRouter({ listTasks });
```

Import default routers in the server entry point:

```ts
// src/server.ts
import { defineServer } from "tailorkit/server";

import tasks from "#functions/tasks";

export default defineServer({ tasks });
```

Regenerate bindings after registration. The client calls `api.tasks.listTasks`. Actions can declare `.functions({ tasks })` and call `queries.tasks.listTasks()`; they receive no direct database handle.
