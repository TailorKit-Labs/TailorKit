# TailorKit Vite integration

`@tailorkit/vite` owns TailorKit app configuration, route discovery, instance
resolver extraction, backend bundling, migration validation, and deployment
manifests. The app runtime lives in `@tailorkit/app`.

App authors import the plugin through `tailorkit/vite`:

```ts
import { defineConfig, lazyPlugins } from "vite-plus";
import { tailorkit } from "tailorkit/vite";

export default defineConfig({
  plugins: lazyPlugins(() => [tailorkit()]),
});
```

For ordinary Vite, import `defineConfig` from `vite` and set
`plugins: [tailorkit()]`. Build output defaults to `.tailorkit`; customize
`build.outDir`, aliases, constants, and plugins in the app's Vite config.

The CLI imports config loading from `@tailorkit/vite/config/loader` and migration
and deployment helpers from `@tailorkit/vite/builder`. The `tailorkit/app/config`
entry point exposes the app config authoring API.
