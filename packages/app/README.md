# TailorKit App

The SDK for building TailorKit extensions.

Apps require Preact 11. Install `preact@^11` alongside the SDK.

## File routing

New apps register views from `src/slots` automatically. Only files ending in `.view.tsx` are views, so supporting components can live beside them.

```text
src/
  root.tsx
  slots/
    panel/
      root.tsx
      layout.tsx
      home.view.tsx
      customers.view.tsx
      customers.layout.tsx
      customers.details.view.tsx
      customer-card.tsx
```

The slot directory is its literal host slot name, including dots in names such as `panel.links`. Dots in a view filename separate route segments: `customers.details.view.tsx` registers `/customers/details`. Subdirectories also separate segments. `customer-card.tsx` is an ordinary component and is ignored unless imported. Duplicate view paths in a slot fail the build.

```tsx
// src/slots/panel/customers.details.view.tsx
import { defineView } from "tailorkit/client";
import CustomerCard from "./customer-card";

export default defineView({ component: CustomerCard });
```

The builder supplies the slot and route before compiling. You can keep an explicit `view` to override the filename and infer the precise host context type:

```tsx
// src/slots/panel/home.view.tsx
import { defineView } from "tailorkit/client";

const view = defineView({ view: "/", component: Home });

function Home() {
  const context = view.useContext();
  return <>Welcome</>;
}

export default view;
```

There are no special view filenames: `index.view.tsx` maps to `/index`. Use a descriptive filename with `view: "/"` for the slot's home view. An explicit slot, if supplied, must match the containing slot directory. Multi-instance views still provide `instances: { dataSchema, resolve }`; resolvers are extracted into the private server bundle. Host slot/view support and multiplicity are validated when publishing. An explicit slot also retains the source-level TypeScript checks for that slot's supported views and instances.

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

`layout.tsx` wraps the entire slot. `customers.layout.tsx` wraps `/customers` and its descendants, with matching at segment boundaries. Layouts follow the resolved view path, including an explicit `view` override. They do not register views themselves. A layout default-exports an ordinary component (or a `defineRoute({ shellComponent })` definition):

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
import { defineConfig, lazyPlugins } from "vite-plus";
import { tailorkit } from "tailorkit/vite";

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
