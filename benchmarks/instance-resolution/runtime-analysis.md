# Runtime resolution latency — 23 October 2026

The warm resolver is not the main measured wait. In ten successful repeated requests, the platform-to-worker call took **127 ms median**, while the worker gateway reported **12 ms**. The paired difference was **116 ms median** outside the gateway's measured interval. Vercel's Undici spans independently confirm the slow HTTP fetch; session signing and RPC serialization are small.

Measurements came from the **T3 harness preview browser**, using the demo's authenticated anonymous workspace. No application or infrastructure configuration was changed. [Credential-free samples and trace evidence](2026-10-23-runtime-analysis.json) include timestamps, request IDs, trace IDs, stage timings and failure results.

## Measurements

Ten sequential successful page probes, with five interleaved no-match controls, ran from 08:53:33–08:53:40 UTC. Each page request selected exactly one Doom resolver and returned one instance. Fetches bypassed browser caching and consumed the body.

| Measurement                                     |   Median |          Range |
| ----------------------------------------------- | -------: | -------------: |
| Browser through complete `/views` response      | 490.3 ms | 402.4–614.3 ms |
| Measured host handler                           | 207.2 ms | 117.3–335.0 ms |
| Outside measured host handler                   | 278.5 ms | 259.6–351.4 ms |
| Host authentication                             |   8.8 ms |    8.3–35.3 ms |
| Host → platform call                            | 197.5 ms | 106.5–298.2 ms |
| Platform call excluding discovery and instances |  63.4 ms |  48.5–136.2 ms |
| Installation discovery                          |   4.0 ms |     3.0–9.0 ms |
| Instance phase, including signing and decoding  | 131.0 ms |  43.0–157.0 ms |
| Session issuance                                |   1.4 ms |     1.2–1.7 ms |
| Platform → worker, through response headers     | 127.2 ms |  39.6–153.8 ms |
| Worker gateway interval                         |  12.0 ms |   11.0–15.0 ms |
| Round trip minus gateway, paired per request    | 115.7 ms |  24.6–139.8 ms |
| Installation interval                           |   0.0 ms |     0.0–2.0 ms |

These stages overlap; do not sum the medians. Outside-host time includes browser scheduling, network, ingress, dispatch and body consumption. It is not pure RTT. The five interleaved no-match controls took 346.0–527.4 ms, with zero or 1 ms in the instance phase. One earlier diagnostic request took 775.5 ms, with a 299.2 ms worker round trip, 221 ms gateway and 47 ms installation interval. It is separate from the repeated sample and is not a verified cold start.

Both Vercel deployments run in `iad1`; the browser responses show `syd1::iad1`. Host: `dc7cd9ad`, deployment `dpl_AvCaeLdXdR8srBnU2FfqEFdto8VW`. Platform: `505668b7`, deployment `dpl_FzHrRhgCFETuQWJGpeUjv6EdcswQ`.

## What the traces prove

Successful trace `f5ca9a03f952689ce81e8e295dc2d3f2` corresponds to the 614.3 ms browser request. Its Undici POST to the worker took **153.48 ms**, matching the 153.8 ms forwarded round-trip header. The worker reported 14 ms gateway and 2 ms installation intervals. Input encoding took 0.043 ms and response decoding 0.629 ms. This locates the large wait in the HTTP/dispatch boundary, rather than Effect fan-out, context encoding or executing the Doom resolver.

The same trace shows **68.27 ms** in `api_platform.create_context`. Within it, API-key verification performed a 25.92 ms `db incrementOne apikey`, a 3.88 ms `db update apikey`, and KV work. These spans are nested and not all additive. Vercel's deployment resolution, route resolution, function invocation and the host's transport add further cost outside the route's discovery/instance timers. This explains why `views_platform - views_discovery - views_instances` must not be described as just network travel.

The application path is:

1. Host authenticates the viewer and validates view context in `packages/core/src/server/routes/views.ts`.
2. Vercel constructs an authenticated platform context in `packages/api-platform/src/context.ts`, including project-key verification.
3. The platform discovers installations, issues fresh identity-bound runtime tokens, and calls selected resolvers concurrently in `packages/api-platform/src/runtime/view-resolution.ts`.
4. Cloudflare verifies and routes the request to the installation; the installation selects its prepared facet and invokes `_patchsmith.instances.resolve`.

The deployed demo's latest commit adds server prefetching with React Query. The initial harness page displayed app data without a browser `/views` resource entry. The measurements above explicitly exercise the HTTP `/views` path and should not be presented as initial sidebar paint timings.

## Interpretation and next work

1. **Investigate the Vercel → Cloudflare boundary first.** Record response `cf-ray` and `cf-placement` in server-side diagnostic spans, together with Undici DNS/connect/TLS timings and connection reuse. Correlate the same request with Cloudflare's request-duration trace, worker version, execution location and installation RPC. Compare repeated calls from the same Vercel process and across processes. The current evidence cannot distinguish DNS/TLS, connection pooling, anycast routing, placement forwarding, scheduling or worker startup before the gateway timer. Do not assume the whole 116 ms is geographic RTT.
2. **Measure and reduce platform authentication bookkeeping.** The project-key path incurs database writes and cache operations before discovery starts. Review those operations while preserving revocation, rate limiting and accounting. A faster installation-discovery query will not remove this cost.
3. **Treat regional placement as a separate experiment.** The checked-in worker already specifies `placement.region: "aws:us-east-1"`, and installation stubs use `locationHint: "enam"`. Confirm deployed placement and actual routing before changing either. Durable Object hints apply on initial creation and are best effort; they do not relocate an existing object. Publishing another app deployment does not establish new object placement.
4. **Keep browser latency separate.** The Sydney-ingress → US-East host path adds roughly 279 ms outside the measured handler in this sample. Prefetching and stable navigation context can reduce visible repeated waits. Changing only the host region may transfer the long-distance hop to its platform call.

The runtime timers use `performance.now()`. Cloudflare advances this clock only after I/O, so zero timings do not establish zero CPU cost. The gateway and installation intervals also omit upstream routing and dispatch before the handlers start. The measured round-trip gap is evidence of an uninstrumented boundary, not a complete breakdown of network versus compute.

References: [Cloudflare timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), [Worker placement](https://developers.cloudflare.com/workers/configuration/placement/), [Durable Object location](https://developers.cloudflare.com/durable-objects/reference/data-location/).

## Separate live authentication failure

At 08:54:06–08:54:12 UTC, all ten follow-up page probes returned 502. Vercel trace `40b0ec3bb7dda24fe6307e8448d8aba3` shows the underlying worker response was **401**, and `orpc.actions` reported **Invalid or expired app token**. These requests are excluded from successful latency statistics. Five attempted auth-only controls omitted required request fields and returned 400; they are also excluded.

A separately acquired runtime token carried `kid: patchsmith-runtime-2026-10-23`. Its signature verified against the public platform key with that same ID. The worker rejected it immediately and again 168 seconds after issuance, with 132 seconds of validity remaining. The checked-in worker trust configuration still contains only `patchsmith-runtime-2026-10-20`. This is strong evidence of a runtime signing/trust rollout mismatch; the live worker trust configuration was not accessible, so its exact state is unconfirmed. The verifier uses configured local keys and does not automatically fetch the platform's current public key set.

Check deployed worker trust and issuer settings, and stage overlapping public keys on verifiers before changing the signer. Preserve old keys for outstanding sessions. This correctness failure requires attention independently of the warm latency investigation. No credentials or tokens are included in the artifacts.

A later harness recheck at 09:09:15 UTC still returned 502. This is a scoped observation from the diagnostic workspace, not a claim that every user's workspace or request was failing.

## Changes proposed after investigation

The platform adds a `runtime.views.fetch` span per resolver HTTP call. It records the response status, round-trip duration, validated Cloudflare Ray/placement headers, allowlisted runtime phases and the round-trip minus gateway interval. Failed responses retain these attributes even when the host cannot return the platform's successful-response timing headers. Caller contexts, tokens and response bodies are excluded. These diagnostics do not yet split DNS/TLS, connection reuse or pre-handler scheduling.

Better Auth already has a Vercel `waitUntil` background-task handler. The project-host API-key configuration now enables the plugin's `deferUpdates` option to use it for expired-key cleanup. In the installed `@better-auth/api-key@1.7.10`, database-backed verification still awaits quota/rate-limit claims, the `updatedAt` write and the resulting cache refresh. Enabling this option does not remove the measured `incrementOne` or promise a reduction in its duration. Moving those claims into the background would weaken concurrent limit enforcement; removing the remaining metadata/cache wait requires a separate upstream change or maintained patch with revocation/concurrency coverage.
