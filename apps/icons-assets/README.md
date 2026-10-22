# Icon assets

`patchsmith-icons-assets` is the independent Cloudflare project for `https://icons.tailorkit.app/lucide/v1/<name>.json`. The catalogue has its own deployment and has no app runtime, authentication, database, KV, or R2 bindings.

Successful requests are served directly by Workers Static Assets through Cloudflare's global asset cache. `public/_headers` supplies public CORS and immutable one-year browser caching. The project uses the default assets-first routing: it does not enable `run_worker_first`.

The small `src/fallback.ts` handler keeps missing files uncached and rejects unsupported methods that reach it. The catalogue supports simple cross-origin GET and HEAD requests; preflight requests are rejected. This is necessary because static `_headers` rules also match nonexistent catalogue paths; serving those 404s with an immutable one-year TTL would prevent retries after a catalogue correction.

## Build and verify

From the repository root:

```sh
pnpm exec turbo run build --filter=@patchsmith/icons-assets
pnpm exec turbo run check-types test --filter=@patchsmith/icons-assets
pnpm --filter @patchsmith/icons-assets exec wrangler deploy --dry-run
```

The build reads every committed compatibility snapshot, including `catalogues/lucide-v1.generated.json`, validates its geometry, and writes individual JSON files plus source license notices under `dist/lucide/v1/`. It does not import the installed Lucide package. Clean builds and deployments therefore retain icons from older upstream releases and older catalogue compatibility versions. For self-hosting, copy `dist/` to your static host and retain `LICENSE.txt`.

`v1` is Patchsmith's catalogue compatibility version, independent of Lucide's npm version. Existing names permanently retain their original geometry, and removed or renamed upstream icons remain available. Introduce a new compatibility version for changes that require removing names or replacing existing geometry.

## Add icons from an upstream release

Update the Lucide catalog dependency in `pnpm-workspace.yaml`, install it, then run:

```sh
pnpm --filter @patchsmith/core generate:icons
```

This command extends the committed snapshot with new names, preserves old entries, retains each source release's license notices, and regenerates the optional SDK name suggestions. Review and commit both generated files. Re-running generation is deterministic; it does not rewrite existing geometry. Do not edit or delete the snapshot to refresh an existing icon.

Deploy the updated catalogue before apps start using its additions. Host, app, platform, and upstream npm versions need not match: compatible SDKs all use `/lucide/v1/<name>.json`. Runtime validators accept safe names absent from their own SDK's suggestions. Missing entries return an uncached 404 and can be retried after the catalogue is updated.

The name types are optional editor assistance, not a runtime allowlist. SDK names and the committed snapshot are checked together in the core tests; generation or type updates can lag a deployed catalogue without blocking newer names at runtime.

The integration tests start a real local Cloudflare runtime and verify static delivery, headers, aliases, license notices, missing files, and routing precedence.

## Deploy

Deploy this project before publishing the SDK:

```sh
pnpm --filter @patchsmith/icons-assets run deploy
```

Wrangler provisions the `icons.tailorkit.app` custom domain. The explicit `icons.tailorkit.app/*` route is also required: it takes precedence over the app runtime's existing `*.tailorkit.app/*` route. Keep both entries in this project's Wrangler config. The app runtime project must not own the icon custom domain.

For Cloudflare Workers Builds, use `apps/icons-assets` as the project root and `pnpm run deploy` as the deploy command. Wrangler's custom build command builds the core dependency and regenerates assets before deployment. This project can deploy independently of `apps/apps-worker` and `apps/web`.
