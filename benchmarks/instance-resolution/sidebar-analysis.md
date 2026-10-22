# Sidebar views latency — 22 October 2026

The sidebar's `POST /api/patchsmith/views` with `slot: "page"` took **619 ms median** in ten repeated live probes. Navbar/panel discovery took **338–351 ms median**. The difference is primarily app-instance resolution, rather than database discovery or response size.

Measurements and request IDs are in [the credential-free samples](2026-10-22-sidebar.json). These baseline measurements predate the runtime performance changes; no application code or deployment was changed during collection.

## Live results

All requests came from the same Australia/Melbourne browser profile, using its existing workspace. Vercel confirmed both demo and platform run in `iad1`; response IDs show `syd1::iad1`. Host commit: `f79f7bd`; platform commit: `e3cdd73`.

| Scenario                                  | Samples | Median |        Range |
| ----------------------------------------- | ------: | -----: | -----------: |
| Authentication only; empty app filter     |      10 | 277 ms |   267–302 ms |
| Navbar discovery                          |      10 | 351 ms |   321–420 ms |
| Panel discovery                           |      10 | 338 ms |   319–451 ms |
| Page resolution; valid nonexistent app ID |      10 | 341 ms |   316–410 ms |
| Sidebar page resolution; installed Doom   |      10 | 619 ms | 589–1,239 ms |

These probes bypass the SDK cache and consume the entire response body. First three rounds were interleaved; remaining cases were collected in batches, with natural idle gaps. This is a small diagnostic sample. The ranges include post-idle requests, not verified cold starts.

A representative successful sidebar request took **609.1 ms**:

| Non-overlapping part | Duration | Evidence |
| --- | --: | --- |
| Outside the measured host handler | 272.4 ms | Total minus `host` |
| Host authentication | 10.8 ms | `views_auth` |
| Platform call excluding discovery and instances | 52.9 ms | `views_platform - views_discovery - views_instances` |
| Platform installation discovery | 4.0 ms | `views_discovery` |
| Session issuance and runtime instance resolution | 268.0 ms | `views_instances` |
| Other host work | 1.0 ms | `host - views_auth - views_platform` |

The outside-host component includes network, ingress, dispatch, browser scheduling and body consumption; it is not a pure network RTT. The 52.9 ms platform remainder includes transport, platform authentication/context creation, middleware and serialization. Existing headers do not split those costs.

The sidebar response was 1,806 decoded bytes, smaller than the 3,441-byte panel response. Resource timing on the initial calls also showed almost all elapsed time before the first response byte.

Initial page load returned a **504 after 1,447 ms**. First navigation to Contacts returned a **504 after 1,423 ms**. Later navigation to Pipeline returned another **504 after 1,329 ms**, leaving the Doom sidebar link absent. These observations are separate from the ten successful repeated sidebar probes. The platform's current [1,000 ms resolution budget](../../packages/api-platform/src/runtime/view-resolution.ts) is additional to discovery, authentication and network time; increasing it would extend waiting without fixing the cost.

## Why this request costs more

1. The demo sidebar (`website/components/app/app-sidebar.tsx` in the demo repository) uses `useViews({ slot: "page" })`. That slot declares `multiple: true`, so the [host route](../../packages/core/src/server/routes/views.ts) invokes platform resolution.
2. The [platform route](../../packages/api-platform/src/routes/apps.ts) discovers installations, then the [resolver](../../packages/api-platform/src/runtime/view-resolution.ts) issues fresh sessions and calls `_patchsmith.instances.resolve` concurrently for selected apps.
3. This workspace selects Doom. Its live resolver returned exactly one constant instance: `{ key: "doom", metadata: { label: "Can it run DOOM?" }, data: {} }`. The demo source at its deployed host commit also defines that constant resolver. No game initialization is needed to calculate this link.
4. Navbar and panel requests only discover installation metadata, avoiding that runtime call.

Median platform database discovery was **4 ms** on sidebar requests. Median instance resolution was **269.5 ms**; slower successful probes recorded 373, 682 and 882 ms in that stage. There is no evidence here that a database index is the main fix.

Host authentication is already memoized per request in [handler.ts](../../packages/core/src/server/handler.ts). The SDK also [shares identical requests](../../packages/client-core/src/client/fetch-client.ts) and [caches ready data for 30 seconds](../../packages/client-core/src/store/fetch/cache.ts). Several `useViews` consumers do not imply duplicate identical network requests.

The demo's `WorkspaceContext` includes `page: usePathname()` in root view context. Navigating from Contacts to Pipeline changed that context and issued another page request, despite Doom's constant result. A different input has a different cache key.

## Ranked optimization options

1. **Support declarative static instances.** Doom's fixed key/label/data could be part of validated deployment metadata and resolved by the platform without starting app code. This requires an explicit SDK/compiler/manifest feature: current multiple slots require an instance resolver. Change source definitions and generators, then regenerate; do not evaluate app-authored functions on the host. Removing the measured 268 ms stage suggests roughly **340–400 ms** total for this scenario, an estimate to verify after implementation. Dynamic and permission-dependent instances must retain their authorized resolver path.

2. **Give navigation a stable context and preserve useful UI during refresh.** For navigation that only depends on workspace identity, declare that dependency separately from the changing page context used by rendered views. Keep isolation by authenticated identity, project, scopes and deployment. Existing cached links can remain visible during a refresh only where those identity and context guarantees hold. Handle sidebar lookup errors explicitly: the current sidebar treats missing data as no app links. This reduces repeat waits; it does not remove first-load cost.

3. **Instrument the runtime before tuning it.** Forward timing for token issuance, worker authentication/routing, metadata KV/platform lookup, bundle loading, facet startup, queue admission and actual resolver execution. Current `views_instances` combines all of these with network travel. The [supervisor](../../apps/apps-worker/src/installation.ts) reads metadata and calls `#prepareFacet` for each action; it also writes the version even when unchanged. Avoiding redundant writes and reusing verified warm state are concrete candidates, subject to publication freshness and invalidation. Their individual savings are unmeasured.

4. **Verify existing object placement and compare like-for-like installations.** The [worker](../../apps/apps-worker/src/worker.ts) already requests `locationHint: "enam"` for new objects. This workspace's installations still reference Doom deployment `3e046d41…` and Messages `b4f8406d…`. Their age does not prove their location. Cloudflare says [hints apply on first creation, are best effort, and do not relocate existing objects](https://developers.cloudflare.com/durable-objects/reference/data-location/). A controlled fresh-installation comparison with identical code is needed; publishing new app code alone does not relocate an object.

For latency materially below the roughly 266 ms outside-host baseline observed here, consider rendering/hydrating sidebar discovery with the initial authenticated document, or placing the host and required services closer to Australian users. Moving only the demo host can transfer the long-distance hop to its platform request.

## Diagnostic limits

Direct browser calls to the same Doom resolver also remained slow: six follow-up requests took 480–1,305 ms, excluding session acquisition. This does not isolate object placement, because browser-to-worker routing differs from platform-to-worker routing. Credentials stayed in browser memory and are absent from the saved observations.

Existing Vercel runtime logs contained no matching records for the queried platform resolution window. No internal Cloudflare trace or exact Durable Object location was available, so attributing the 269.5 ms specifically to geography, KV, startup, or user-code execution would require the additional timings above.
