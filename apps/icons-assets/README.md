# Icon assets

`patchsmith-icons-assets` is the independent Cloudflare project for `https://icons.tailorkit.app/lucide/1.59.0/<name>.json`. The SDK URL stays the same. The catalogue has its own deployment and has no app runtime, authentication, database, KV, or R2 bindings.

Successful requests are served directly by Workers Static Assets through Cloudflare's global asset cache. `public/_headers` supplies public CORS and immutable one-year browser caching. The project uses the default assets-first routing: it does not enable `run_worker_first`.

The small `src/fallback.ts` handler keeps missing files uncached and rejects unsupported methods that reach it. The catalogue supports simple cross-origin GET and HEAD requests; preflight requests are rejected. This is necessary because static `_headers` rules also match nonexistent catalogue paths; serving those 404s with an immutable one-year TTL would prevent retries after a catalogue correction.

## Build and verify

From the repository root:

```sh
pnpm exec turbo run build --filter=@patchsmith/icons-assets
pnpm exec turbo run check-types test --filter=@patchsmith/icons-assets
pnpm --filter @patchsmith/icons-assets exec wrangler deploy --dry-run
```

The build imports the pinned Lucide development dependency, validates its geometry, and writes individual JSON files plus upstream ISC and Feather MIT license notices under `dist/lucide/1.59.0/`. No icon modules enter a browser or Worker bundle. For self-hosting, copy `dist/` to your static host and retain `LICENSE.txt`.

The SDK name enum is generated from the same release with `pnpm --filter @patchsmith/core generate:icons`. Catalogue versions are part of the published SDK contract. When adding a release, keep inputs for previous releases and include their directories in every deployment; do not remove files while released SDKs reference them.

The integration tests start a real local Cloudflare runtime and verify static delivery, headers, aliases, license notices, missing files, and routing precedence.

## Deploy

Deploy this project before publishing the SDK:

```sh
pnpm --filter @patchsmith/icons-assets run deploy
```

Wrangler provisions the `icons.tailorkit.app` custom domain. The explicit `icons.tailorkit.app/*` route is also required: it takes precedence over the app runtime's existing `*.tailorkit.app/*` route. Keep both entries in this project's Wrangler config. The app runtime project must not own the icon custom domain.

For Cloudflare Workers Builds, use `apps/icons-assets` as the project root and `pnpm run deploy` as the deploy command. Wrangler's custom build command builds the core dependency and regenerates assets before deployment. This project can deploy independently of `apps/apps-worker` and `apps/web`.
