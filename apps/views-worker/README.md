# Cloudflare view resolution experiment

The publishable SDK support from [PR #399](https://github.com/patchsmith-io/patchsmith/pull/399) is available in `0.1.0-beta.64`. Deploy this Worker from its branch to test it without merging the Worker experiment.

This optional backend serves `POST /api/platform/apps/runtime/resolve`. The host still authenticates its own users, validates view context, and provides authorized scopes. Hosts can run on any provider. Vercel continues to serve the platform's other routes and remains the default resolution backend.

The request path is:

```
browser → host /views → views Worker → existing installation Durable Object
                               ↘ Hyperdrive → existing platform Postgres
                               ↘ shared Upstash (project keys and rate limits)
```

The Worker reuses the platform's discovery, session, view selection, resolution budget, cancellation, warning, and timing implementations. A cross-script Durable Object namespace binding reaches `patchsmith-apps-worker`'s existing `PatchsmithAppInstallation` objects. It creates no new namespace, installation storage, or app runtime. Runtime JWT verification still happens inside the object. There is no CORS/browser API: the project key stays on the host server.

## Configure and deploy

1. Build dependencies with `pnpm exec turbo run build --filter=@patchsmith/views-worker^...`.
2. The checked-in Hyperdrive configuration `325f3c2afdff4a3face8971e67334b40` connects to the platform Postgres database with query caching disabled. Keep **query caching disabled** for authorization, revocation, and deployment selection. For another environment, replace this ID with a configuration for that environment's database. See [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
3. Configure Worker secrets through `wrangler secret put`:
   - `AUTH_SECRET`: the platform's existing Better Auth secret.
   - `APP_RUNTIME_SIGNING_KEY`: the platform's **same active ES256 private JWK**, including `kid`; the existing runtime must trust its public key.
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN`: the **same Upstash database** used by the platform, to share API-key state, invalidation, and organization rate limits. Do not use a separate Redis database for this experiment.
4. Keep `PLATFORM_URL` equal to the existing runtime issuer (`https://patchsmith.io/api/platform`). Changing it would change object names and break token trust. Keep `ASSET_DOMAIN` aligned with the runtime.
5. Deploy the new Worker with `pnpm --filter @patchsmith/views-worker deploy`. The existing apps Worker must already be deployed in the same account. No migration or redeployment of its Durable Objects is required. Cross-script bindings use [`script_name`](https://developers.cloudflare.com/durable-objects/reference/environments/).
6. On a host server using SDK `0.1.0-beta.64` or later, opt in:

   ```ts
   createPatchsmithServer({
     // Existing host configuration, authentication, scopes, and projectKey…
     $internal: {
       runtimeResolveBaseUrl:
         "https://patchsmith-views-worker.<account>.workers.dev/api/platform",
     },
   });
   ```

Only `/apps/runtime/resolve` uses this override. App installation, deployment, ordinary discovery, runtime-session requests, and every other platform API remain at the host's existing `platformBaseUrl`. The option is deliberately internal for this experiment. Remove it to roll back immediately.

For local development, provide secrets in an ignored `.dev.vars` file and set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to a local Postgres URL. The checked-in localhost connection is a placeholder. Local development also requires a companion apps Worker for the external Durable Object binding; a standalone views Worker cannot emulate those existing objects.

## Measure

Compare the same host and installation with the override enabled and disabled. Capture fresh-install, warm repeated, and idle-then-first requests separately. Do not compare different installs as if they were identical runtime state.

The host still reports `views_auth`, `views_platform`, and its total duration. The resolution response retains `views_discovery`, `views_instances`, `views_session_max`, `runtime_roundtrip_max`, and the installation's runtime phases. It additionally reports `platform_auth` (key verification, project lookup, and organization limit) and `platform_total`. These timings overlap; do not add maxima together. Database connection setup precedes `platform_total`; compare the host's measured platform round trip with Worker telemetry to observe that gap. The direct binding bypasses the public gateway, so no `runtime_gateway_max` is expected from this backend.

This is an experiment, not a measured performance claim. Placement starts near US East, matching the current platform data and runtime deployment. Hyperdrive pools origin connections; each request creates and closes its own `pg.Client`. There is no global request-owned socket or database state.

The host's network round trip, shared Upstash calls, database queries, and Durable Object wake/queue time remain. The runtime's existing **cold metadata recovery** still calls the platform's metadata endpoint; this PR does not move provisioning, publication, or recovery onto the new Worker.

## Validation

Run affected checks from the repository root:

```sh
pnpm exec turbo run check-types test --filter=@patchsmith/views-worker --filter=@patchsmith/api-platform --filter=@patchsmith/core --filter=@patchsmith/auth --filter=@patchsmith/api-utils --filter=@patchsmith/apps-worker
pnpm exec turbo run build --filter=@patchsmith/views-worker
pnpm check
```

The Worker tests use the real Better Auth API-key plugin, PGlite with platform migrations, real scope canonicalization/discovery, real ES256 issuance and verification, and an injected installation transport. They do not contact a production database or Redis service. Deployment and comparative latency testing require the configured Hyperdrive binding and shared secrets above.
