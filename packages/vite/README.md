# Patchsmith Vite integration

`@patchsmith/vite` builds Patchsmith apps. It loads app configuration, discovers routes, extracts instance resolvers, bundles backend code, validates migrations, and writes deployment manifests. The app runtime lives in `@patchsmith/app`.

## Configure the plugin

Import the plugin through `patchsmith/vite`:

```ts
import { patchsmith } from "patchsmith/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [patchsmith()]),
});
```

For ordinary Vite, import `defineConfig` from `vite` and set `plugins: [patchsmith()]`. The plugin finds `patchsmith.config.ts` beside the loaded Vite config. To use another file, pass `patchsmith({ configPath: "./config/patchsmith.config.ts" })`; relative paths always resolve from the Vite config directory. App source and output paths also resolve from that directory. Build output defaults to `.patchsmith`; customize `build.outDir`, aliases, constants, and plugins in the app's Vite config.

## Internal entry points

The CLI imports config loading from `@patchsmith/vite/config/loader` and migration and deployment helpers from `@patchsmith/vite/builder`. The `patchsmith/app/config` entry point exposes the app config authoring API.
