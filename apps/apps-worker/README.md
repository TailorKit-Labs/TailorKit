# App runtime

`patchsmith-apps-worker` runs app queries, mutations, actions, and subscriptions on Cloudflare. It also delivers public client assets and logos. This private runtime is licensed under BUSL-1.1.

The Patchsmith command-line interface (CLI) uploads server bundles to the private blob bucket under `server/server.js`. Client code uses `client/client.js`. The worker’s asset allowlist excludes server bundles.

## Store gzip and negotiate browser delivery

The CLI compresses client and server bundles with gzip before uploading them to R2. Store one gzip representation per bundle; browser delivery formats do not require additional R2 objects.

The public asset response preserves the stored gzip bytes with `Content-Encoding: gzip` and `encodeBody: "manual"`. This prevents workerd from compressing them again. Cloudflare's CDN can still negotiate the browser-facing format according to the visitor's capabilities and the zone's Compression Rules. The Worker-facing `Accept-Encoding` is normalized by Cloudflare; do not use `request.cf.clientAcceptEncoding` to select the stored representation. Direct/local requests retain an identity fallback.

Internal edge-cache entries store opaque bytes with private encoding metadata and `Cache-Control: public, max-age=86400, no-transform`. Public responses remove the private metadata and use `Cache-Control: private, max-age=3600`, allowing CDN compression transformations. Keep `no-transform` off the public response when delegating negotiation to Cloudflare.

Backend execution reads the private gzip object through the R2 binding and decompresses it in the trusted supervisor before passing source code to the dynamic loader. Browser format negotiation does not affect this path.

Local Miniflare tests verify stored bytes, cache behavior, and public headers. Validate the deployed zone separately with `Accept-Encoding: br`, `gzip`, and `identity`; the selected delivery encoding depends on the zone configuration. See [Cloudflare's compression behavior](https://developers.cloudflare.com/speed/optimization/content/compression/).

The public icon catalogue is deployed independently from [`apps/icons-assets`](../icons-assets/README.md).

## Authenticate app requests

The host SDK uses its existing `authenticate` callback and calls `POST /apps/{appId}/runtime/session` with its project key, verified scopes, required product-defined `subjectId`, and product tool URL. The platform checks the app belongs to that project and one of those scopes, resolves its published deployment, and issues a short-lived ES256 JSON Web Token (JWT).

The canonical app ID is the stable installation ID and JWT `sub`. `subjectId` identifies the authenticated product user or service principal and is required on every session and signed token. Apps cannot supply a verified subject.

The platform returns `https://<projectShortId>.tailorkit.app/a/<appShortId>/rpc`, deriving the hostname from `ASSET_DOMAIN` (default `tailorkit.app`). `APP_RUNTIME_URL` is an optional origin override for local development.

The signed JWT binds the project and app short IDs as well as the canonical project/app IDs; the gateway checks the hostname and path before routing to a trusted installation. Sandboxed apps obtain scoped JWTs through the host bridge and call the backend over authenticated HTTP, with a WebSocket for query subscriptions. Platform credentials remain in the host server.

The installation ID stays the same across public/internal app IDs, scope-list ordering and published deployments.

The runtime derives its issuer from `PLATFORM_URL` and verifies JWTs using `APP_RUNTIME_PUBLIC_KEYS`, a configured public JSON Web Key Set (JWKS). The runtime makes no public-key request. The shared app JWT audience is `patchsmith-app`. Calls allow browser origins and omit cookies; JWT authorization remains mandatory.

The worker authenticates and routes requests to the supervisor named `[issuer, projectId, appId, installationId]`. The supervisor verifies authentication again and resolves the selected deployment from its own SQLite-backed KV storage, falling back to the authenticated platform API when metadata is missing or a new deployment hint needs confirmation. A different app/project is forbidden. Deployment claims do not pin execution: existing client code continues calling the latest published server.

## Load and isolate app code

The supervisor reads the exact private R2 key returned by the platform, verifies the stored size and SHA-256, decompresses gzip bundles with a 3 MiB limit on the decoded code, and combines the application module with its own Cloudflare bootstrap. Existing uncompressed bundles remain supported.

One dynamic `AppFacet` runs queries, mutations, and actions. Its loader key includes the installation, deployment and checksum. The facet receives no platform credentials or bindings. The runtime disables native networking with `globalOutbound: null`; a global fetch wrapper allows active actions to use a scoped trusted RPC capability. The runtime passes verified identity directly over remote procedure calls (RPC), excluding browser headers.

Each installation uses the fixed facet name `app`. Updating code aborts the old facet and starts the new class with the same SQLite database. Deployment IDs never select databases. This is Durable Object SQLite, not D1. One published deployment runs at a time.

Existing sockets reconnect to the replacement without remounting client UI. Each new facet synchronously applies the deployment's pending app migrations before accepting database calls; concurrent versions are unsupported.

## Refresh authentication and subscriptions

External database requests and subscriber refreshes share an installation-local queue; actions execute independently and call database handlers directly inside the facet. Each synchronous database handler completes without interleaving.

Platform-issued tokens last five minutes. The trusted installation ends subscriptions at token expiry; the app client refreshes authentication through the JWT bridge one minute before expiry and reconnects with fresh query snapshots.

WebSockets use oRPC hibernation: the trusted installation persists subscription records, keeps only connection IDs in socket attachments, and uses storage alarms to close expired sessions. Socket lifecycle, durable records and dependency tracking live together in `src/supervisor/subscriptions.ts`; oRPC encoding and delivery remain in `src/transport.ts`.

`src/supervisor/source.ts` reads and authorizes cached published metadata, verifies bundle integrity, and caches code per warm installation. Effect handles execution errors, trusted coordination, serialized database access and scoped action cleanup. The app SDK separates synchronous persistence, asynchronous execution and subscription delivery; neither apps nor browser clients need Effect. The execution implementation is coupled to Cloudflare and remains private; the public app API and oRPC contract stay in the Apache-2.0 SDK.

`projectId` comes from the verified JWT and remains part of the stable installation identity. The runtime has no fixed project or environment scope.

## Configure runtime credentials

Configure the same private service credential as `RUNTIME_SERVICE_TOKEN` on this worker and `APP_RUNTIME_SERVICE_TOKEN` on the platform server (at least 32 characters). It authorizes only the published bundle metadata endpoint; it cannot upload, publish or call other platform APIs. The platform checks the requested app belongs to the project before returning its private R2 key. This credential stays in trusted infrastructure and is never given to app developers or dynamic code.

The platform needs `APP_RUNTIME_SIGNING_KEY`, an ES256 private JSON Web Key (JWK) with a stable `kid`, stored as a server secret. Its `OPENAPI_SERVER_URL` must match the runtime's `PLATFORM_URL` (trailing slash is normalized). Configure matching public key material in this Worker's `APP_RUNTIME_PUBLIC_KEYS` variable, as a JWKS object or JSON string. Replace the empty `keys` placeholder before running against a real platform.

For rotation, deploy the new public key to the Worker before changing the platform signing key, retaining the previous public key for at least six minutes. Private keys stay only on the platform.

## Request flow

The host returns the runtime's `/rpc` base URL. The client selects the route:

| Route | Transport | Execution |
| --- | --- | --- |
| `/rpc/queries` | POST JSON | SQLite facet, one-off query |
| `/rpc/mutations` | POST JSON | SQLite facet, committed write and subscription updates |
| `/rpc/actions` | POST JSON | Shared dynamic facet, outbound HTTPS through a scoped capability |
| `/rpc/queries` | GET WebSocket upgrade | Trusted Durable Object, query subscriptions |

The table paths are relative to `/a/<appShortId>`. HTTP requests and responses use the oRPC wire protocol. Procedure inputs contain `{ name, args }`; mutations also require a UUID `requestId`. oRPC preserves typed errors and their HTTP statuses. The URL determines the operation type, so bodies cannot override it. Nested names such as `todos.list` retain their full path. WebSockets expose subscriptions only.

The gateway authenticates and selects the trusted installation Durable Object. The installation verifies the published deployment with Effect, owns WebSockets and subscriptions, and calls the isolated SQLite facet directly over RPC.

Each internal RPC call returns `{ result, tables, committed }`, where `result` contains either `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. Values pass schema and JSON serialization validation before mutations commit.

Queries report their read dependencies; mutations report changed tables. Errors retain table metadata, but rolled-back and replayed mutations do not invalidate subscriptions. The trusted oRPC transport translates values and errors into the client wire protocol and generates HTTP headers.

Actions call queries and mutations directly in the same execution engine, entering fresh database contexts with the same verified identity. Mutation transactions and receipts stay local. After each committed mutation, the facet reports changed tables to the trusted installation and awaits subscriber refreshes before continuing. Replayed and rolled-back writes do not send notifications. Earlier writes remain committed if the action later fails.

The application builder exports only the app definition and embedded migrations in `server/server.js`. It ships no Cloudflare bootstrap classes. The worker builds its bootstrap independently. It installs an AsyncLocalStorage (ALS) fetch guard before importing the app and initializes SQLite before admitting handlers.

Queries and mutations remain synchronous; actions remain asynchronous. Action query/mutation collections are checked and compiled during initialization; callbacks are bound to each invocation. A fresh context is established for every handler, including database calls made by actions. The fetch guard enforces networking rules within shared app code. It does not isolate malicious handlers from each other.

## Execute actions

Each action gets one `ActionCapability` for outbound HTTP and committed-table notifications. It exposes no database call bridge, platform credentials, R2 binding, installation namespace or SQLite handle. Actions are cancelled on token expiry, request cancellation, completion or deployment replacement. The runtime sets no action concurrency quota, database or outbound call-count quotas, or separate 30-second action timeout. Cloudflare CPU and subrequest limits still apply.

The gateway allows public HTTPS endpoints, checks every redirect, and rejects literal private/loopback addresses and local/internal hostnames. It forwards no platform credentials.

Cancellation streams cross RPC boundaries because attached `AbortSignal` objects cannot be serialized. Actions share module state with queries and mutations; they do not have fresh isolates. Local query/mutation calls remain one-off executions; an action as a whole is not a transaction.

## Code layout

The public protocol and private runtime code live in these modules:

- `@patchsmith/app/protocol`: public oRPC procedures, input/output types and migration inputs, with no server implementation.
- `src/runtime`: private execution, ALS, fetch guard, database transactions, receipts and migration application.
- `src/transport.ts`: private implementation of the public contract, HTTP/WebSocket handlers and event encoding.
- `src/supervisor`: four modules for authentication, deployment loading, action cancellation/egress and subscriptions.
- `src/runtime/cancellation.ts`: cancellation streams shared by the facet and trusted worker.
- `src/dynamic-workers/facet.ts`: Cloudflare bootstrap and SQLite adapter.
- `@patchsmith/api-utils/app-auth`: private JWT helpers shared with the platform backend.

## Run and test locally

Run typechecks and tests from the repository root. Turborepo builds their dependencies:

```sh
pnpm exec turbo run check-types test --filter=@patchsmith/apps-worker
```

The test command dry-builds with Wrangler and runs its bundled Miniflare/workerd locally with disposable R2 and Durable Object state. It substitutes only the trusted platform metadata HTTP response. The `backend-todo` integration test covers:

- JWT and project checks, token expiry, and rejection of old tokens
- Private R2 downloads, code hashes, isolation, and blocked network access
- Deployment switches, cold restart persistence, and WebSocket renewal
- HTTP queries, mutations, actions, and nested function dispatch
- Query subscriptions, accepted-write deduplication, and realtime updates between two clients

Server artifacts include Drizzle-generated migration SQL and checksums. Facet initialization applies pending migrations and records their history in `patchsmith_migrations`, in the same isolated SQLite database as the app tables. The integration test uses this production bootstrap and verifies upgrades, failed-migration rollback, cold recovery and fresh installations after an upgrade.

To run the gateway against a development platform, copy `.dev.vars.example` to `.dev.vars`, fill in the platform URL and private runtime service token, and set the R2 bucket in `wrangler.jsonc` to the same private bucket used by the platform blob provider.

Upload and publish app bundles with `patchsmith deploy`. The CLI gzips client and optional server code, obtains private upload URLs from the platform, and uploads the compressed bytes with signed content-encoding and checksum headers. Client assets are served with `Content-Encoding: gzip` when accepted, with decoded delivery otherwise.

Before publication, the platform downloads gzip client bundles and rejects decoded code above 3 MiB. Worker and Node delivery also cap decoded streams at 3 MiB. The Node asset adapter serves the decoded stream supplied by Node fetch. When the platform blob provider uses R2, both files go into that R2 bucket. The runtime's `BUNDLES` binding must point to the same bucket.

`wrangler dev --local` uses a separate local R2 store; ordinary Patchsmith deployments do not populate it. Use `test` for the complete local runtime demonstration: its test fixtures populate disposable R2 directly, without a seed command.

Start the local worker from the repository root:

```sh
pnpm --filter @patchsmith/apps-worker dev
```

Wrangler watches runtime/server changes. App code is rebuilt and uploaded through the existing app builder/CLI, then published through the existing deployment flow. Changing local runtime code does not publish an app deployment.

Durable Object and R2 state lives in `apps/apps-worker/.patchsmith/state`, outside app builder output.

Local compatibility uses the date supported by the repository's pinned workerd. No production deployment is performed by these commands.

The runtime enforces the 3 MiB decoded bundle limit described above. It also verifies bundle content length and checksum for integrity.

## Build and deploy

Run these commands from the repository root:

```sh
pnpm --filter @patchsmith/apps-worker build
pnpm --filter @patchsmith/apps-worker deploy
```

`build` runs `wrangler deploy --dry-run --outdir dist`; `deploy` runs `wrangler deploy`. Both use Wrangler's custom build hook to build workspace dependencies and generate `.generated/bootstrap.txt` from `src/dynamic-workers/facet.ts`. The bootstrap is separate source text for the isolated app loader. Wrangler bundles the trusted worker and includes that text module. Do not remove the bootstrap generation or deploy `dist/index.js` separately.

Direct `pnpm exec wrangler dev` and `pnpm exec wrangler deploy` also work from `apps/apps-worker`. No manual dependency build is required. Wrangler watches the worker, bootstrap build script, and imported workspace sources during development. Turborepo caches both `dist` and `.generated`, so cached builds restore the files needed by tests.

In the Cloudflare dashboard, open this Worker's **Settings > Builds > Build configuration** and set:

- Root directory: `apps/apps-worker`
- Production branch: `main`, with production builds enabled
- Build command: `pnpm run build`
- Deploy command: `npx wrangler deploy` (equivalent to `pnpm run deploy`)
- Builds for Preview branches: disabled under **Previews Base**

Preview branch builds are controlled in the dashboard. `preview_urls: false` in `wrangler.jsonc` only disables public version URLs; it does not disable branch builds. This worker deploys from `main`. Pull requests run GitHub CI, including the Wrangler dry build and local runtime tests. Enabling Cloudflare branch previews would require a separate `previews` configuration. See Cloudflare's [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Set the build variables `NODE_VERSION=24` and `PNPM_VERSION=12.11.2` to match this workspace; let Cloudflare install dependencies from the root lockfile. See Cloudflare's [build image settings](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

The connected Cloudflare Worker must be named `patchsmith-apps-worker`, matching `wrangler.jsonc`. Set `RUNTIME_SERVICE_TOKEN` as a runtime secret on that Worker; the platform must use the same value for `APP_RUNTIME_SERVICE_TOKEN`.

The public routes and `ASSET_DOMAIN` remain `tailorkit.app`. Production resources use Patchsmith names:

- `BUNDLES`: private R2 bucket `patchsmith-app-assets-prod`. Set the platform's `BLOB_BUCKET` to this same bucket and grant its S3 credentials access to it.
- `STORES`: `PatchsmithAppInstallation`, which creates a fresh Durable Object namespace under `patchsmith-apps-worker`. The `AppInstallation` deletion tombstone retires the previous namespace and its data when this configuration deploys.
- Signing key: `patchsmith-runtime-2026-10-20`. The platform's `APP_RUNTIME_SIGNING_KEY` must contain the matching private JWK; only its public key belongs in this repository.

The rebrand deliberately starts with an empty asset bucket and installation databases. Old bundles and app data are not migrated. Republish apps after deploying the worker and platform. Stage the new public key on the running worker before the platform begins issuing tokens with it; keep the old public key accepted until existing tokens have expired. The committed configuration completes that rotation on the next worker deployment. Platform environment changes apply to its next deployment, so deploy both sides together and verify a fresh upload, publication, and app call.

## Current limits

Account for these limits when publishing apps or operating the runtime:

- App migrations are bundled with server deployments and applied lazily per installation. There is no remote migration endpoint or bulk migration command. Applied history is immutable; deployments with changed applied migrations are rejected. Older bundles may contain an exact prefix of applied history without undoing migrations. Database downgrades and adoption of pre-existing unmanaged tables are unsupported. Large migrations and backfills can exceed the facet CPU limit.
- The platform is the only token issuer. Project keys limit hosts to their own projects; hosts remain responsible for authenticating their users and returning verified scopes. The platform authorizes app access against those scopes and derives installation IDs from the authorized app. The platform has no customer-host user membership database.
- Deployment metadata and verified decoded source persist in each supervisor’s SQLite-backed KV storage. Metadata older than one hour is revalidated in the background. Missing metadata and changed token hints require an authoritative platform lookup. An uncached deployment downloads its bundle from R2; restarts reuse persisted source.
- Updates close existing subscription connections; clients reconnect to the latest deployment without remounting the app. Schema compatibility across updates remains the app developer's responsibility.
- Runtime limits constrain CPU and subrequests; quotas, abuse accounting and facet/database lifecycle cleanup are future work. Untrusted apps can break their own schema or invalidation tracking.

## Check bundle compatibility

Application bundles export a `runtimeManifest` alongside the default application definition and migrations. The SDK builder emits `{ apiVersion: 1, requires: ["database", "actions", "database-relations"] }`.

The facet validates the exports, API version, and required features before touching SQLite. Unsupported bundles fail with `INCOMPATIBLE_VERSION`.

Breaking handler/module changes increment `apiVersion`; additive capabilities can be named in `requires`. Bundles only require a runtime upgrade when their declared interface or required features are unsupported. The shared `ApplicationModule` and `RuntimeManifest` types are exported by `@patchsmith/app/server`.

## Deployment metadata cache

The platform sends `POST https://internal.tailorkit.app/p/<projectId>/a/<appShortId>/new-deployment` after publication or a rollout. `APP_RUNTIME_INTERNAL_URL` optionally overrides that origin; by default it is `https://internal.<ASSET_DOMAIN>`. Only the reserved internal hostname accepts publication requests.

The worker checks that the body project and private bundle path match the URL. The body contains `{ projectId, appId, deploymentId, objectKey, checksum, contentLength }`.

Requests use `Authorization: Bearer your_runtime_service_token`; configure that same secret as `RUNTIME_SERVICE_TOKEN` on the worker. It is independent of signing keys and never enters app code. Vercel calls the worker over HTTPS and needs no Cloudflare API credentials.

Each supervisor persists deployment metadata, its last validation time, and the last confirmed token hint in its own SQLite-backed KV storage. There is no Workers KV namespace binding. Metadata does not expire: requests serve a matching cached deployment immediately, and metadata older than one hour starts one background revalidation. A failed background refresh retains the cached record and backs off for one minute. Revalidation happens on access, without polling idle objects. Missing metadata or an unrecognized deployment hint requires synchronous confirmation. Every request still verifies authentication and installation identity.

Source-app rollouts update all installations selecting one of that source's deployments. The source row serializes rollouts and installation creation; delayed rollout notifications cannot undo a newer selected version. After rollout, the platform starts `warmAppDeployment`, registered through `apps/web/workflows/app-deployment.ts`. It enumerates installations in pages of 50 and warms batches of ten independently retryable steps. Each step rereads its target's current selection before posting metadata. Install requests warm their new installation directly, without starting a workflow. Warm-up failures are logged without undoing installation or publication; new token hints still recover synchronously.

The internal endpoint routes to the supervisor's trusted `warm` RPC. The RPC confirms the latest selection with the platform before preparing code, so a delayed or retried publication cannot select stale code. Metadata lookups are serialized within the supervisor. Warm-up downloads, verifies and decodes uncached code, persists it, and acquires the facet; it does not invoke application handlers or eagerly run migrations. Memory-resident facets can still be evicted by Cloudflare.

Verified decoded source is retained for one deployment per supervisor, keyed by deployment ID, checksum and encoding. Source is split into 16,384-code-unit chunks to stay below the per-value storage limit. Synchronous writes replace chunks and the manifest together, deleting unused chunks from the previous version. Cold restarts reconstruct source from local storage without R2 or decompression. App code cannot access the supervisor's metadata or source cache. The sandbox facet's database remains separate.

Every deployment change closes subscription connections and cancels active actions on facet replacement. Clients reconnect without remounting the app. Server deployments must preserve compatibility with existing client code; cancelled actions are not automatically retried.

## Runtime timings

HTTP RPC responses include `Server-Timing` durations in milliseconds. The gateway preserves installation timings and appends `runtime_gateway` (gateway request through installation response) and `runtime_gateway_auth`. Installation phases are `runtime_installation` (total), `runtime_auth`, `runtime_queue` (initial semaphore admission), `runtime_metadata`, `runtime_prepare` and `runtime_execute`. Metadata includes nested `runtime_metadata_platform` when an authoritative lookup occurs. Preparation includes `runtime_bundle` for restoring persisted source or reading, verifying and decoding an uncached bundle; warm prepared facets skip that work entirely. There is no shared KV pointer.

These phases overlap: totals include their children. `runtime_execute` measures the facet RPC, including first-use facet startup, migrations, app execution and any tool/network calls. It does not isolate the app handler's CPU time. WebSocket upgrade responses are passed through unchanged.

Platform view-resolution responses forward allowlisted numeric runtime phases with a `_max` suffix and include `views_session_max` and `runtime_roundtrip_max`. Each is the maximum observed across concurrent app calls, so maxima can come from different installations and must not be added. The round trip ends at response headers; `views_instances` also includes response decoding and validation. Comparing a single installation's gateway duration with its platform round trip helps identify transport/dispatch overhead, without proving the object's geographic placement. Timing headers contain no tokens, context values, installation IDs or app output.

## Installation location diagnostics

Call `POST https://internal.<ASSET_DOMAIN>/diagnostics/installation` with the runtime service credential in the `Authorization: Bearer ...` header and a JSON body containing `objectId`, the 64-character supervisor ID from a Durable Object trace event's `durableObjectId`. The endpoint targets that exact object in the existing `STORES` namespace. It rejects supervisors without a prepared deployment and does not load app code, read R2, refresh deployment metadata, or write storage.

The supervisor makes one outgoing request to `https://www.cloudflare.com/cdn-cgi/trace`, with a three-second timeout and redirects disabled. Only the three-letter `colo` is retained; IP addresses and other trace fields are discarded. The outgoing colo is an inferred execution-location signal, not a physical-location guarantee. This is the technique used by [Where Durable Objects Live](https://github.com/helloimalastair/where-durableobjects-live/blob/main/apps/worker/src/DO.ts).

The JSON response contains:

- `requestId` and `objectId`, also included in correlated gateway and supervisor logs. The request ID is generated by the gateway and returned in `x-patchsmith-request-id`.
- `colo`, `source: "outbound-trace"`, `probeMs`, and `installationMs` from the supervisor.
- `gateway.ingressColo` from incoming request metadata and `gateway.placementHeader` from `cf-placement` when available. These fields describe ingress and a gateway placement hint; they do not identify the supervisor's location. Missing or unrecognized values are `null`.
- `timings.lookupMs`, `timings.roundtripMs`, and `timings.outsideInstallationMs`. The round trip measures the diagnostic RPC and includes the outgoing probe. The final field subtracts the supervisor's measured handler duration and clamps at zero; it is an estimate of forwarding overhead, not a one-way network measurement. Cloudflare's I/O-gated timers limit precision.

Responses use `Cache-Control: no-store`. Unsupported methods return 405, invalid credentials 401, invalid input 400, unprepared supervisors 404, and failed location probes 503. Normal app RPCs do not run the diagnostic probe. Deploy the Worker to enable this internal endpoint; no platform or app package release is required.

## Sandbox networking

Sandbox iframes allow HTTP(S) and WebSocket connections. They retain an opaque `null` origin through `sandbox="allow-scripts"`; backend calls omit cookies and require scoped JWTs. Initial rendering does not require a backend session.

## Shared app delivery

One `patchsmith-apps-worker` deployment handles the wildcard `*.tailorkit.app/*` route and the `internal.tailorkit.app` custom domain. Keep this worker name and the `STORES` binding stable to preserve installation databases. Configure wildcard proxied DNS for `*.tailorkit.app`; Wrangler provisions the internal custom domain. The platform's `ASSET_DOMAIN` must match this worker's value.

Project routes:

- `/a/<appShortId>/d/<deploymentShortId>/client/client.js`: immutable public client bundle.
- `/a/<appShortId>/d/<deploymentShortId>/logos/<filename>`: logos. Content-addressed logos use shared R2 storage.
- `/a/<appShortId>/rpc/queries`, `/rpc/mutations`, `/rpc/actions`: HTTP backend calls; query subscriptions use WebSockets on the queries route.

R2 keys start at `projects/<projectShortId>/apps/<appShortId>/deployments/<deploymentShortId>/`. Content-addressed logos remain shared under the app prefix. Local asset URLs use `/api/assets/p/<projectShortId>/a/<appShortId>/d/<deploymentShortId>/` instead of a project subdomain.

RPC URLs omit the deployment ID and run the latest published backend. Deployment claims never select a separate database or pin execution. Asset responses preserve their edge cache, bounded browser TTL and security headers. RPC responses are not cached.

Shared asset admission, size checks, and sanitized error responses are Effect programs in `@patchsmith/asset-delivery`; the Cloudflare and Node adapters compose storage, fetch and cache operations with Effect and run them at the request boundary. Cache lookup/write failures do not prevent asset delivery.

The platform needs `APP_RUNTIME_SIGNING_KEY` and `APP_RUNTIME_SERVICE_TOKEN`; no `APP_RUNTIME_URL` is needed for production's default project subdomains. Deploy the combined worker and platform, and delete the standalone `patchsmith-assets` Worker and its Workers Builds integration. Only the new URLs and signed routing claims are supported.

## Product tools

App backend actions call server tools through `ctx.tools`. The trusted supervisor sends the verified app execution JWT directly to the product tool destination signed into that JWT, preserving installation, scope, and optional subject.

The same five-minute app credential authorizes the runtime and product tools with the `patchsmith-app` audience. There is no tool-specific JWT or credential exchange.

The product verifies the signature, issuer, audience, expiry, destination, scope, and active installation/deployment before validating input and output. Dynamic backend code receives no credentials.

App frontends use generated callers for server tools over authenticated HTTP and client tools through the trusted sandbox bridge. They share the app backend session provider and its principal-specific credential cache. Client implementations live in the product frontend; backend actions have no client-tool capability. Query, mutation, and action APIs remain the app backend API.
