# Instance resolution: platform orchestration

The host can run anywhere. Keep user authentication and registered context-schema validation on the host, and keep app discovery, runtime-session issuance, and resolver fan-out on the Patchsmith platform near the app runtime.

The public host `/views` request and result shapes stay unchanged. Multiple-slot requests send validated candidate contexts, verified scopes, the authenticated subject, and the trusted tool URL to `/apps/runtime/resolve`. The platform queries installations in that project and those scopes, selects the nearest enabled supported view, and calls the generated resolver for each match concurrently. App code continues executing in its Durable Object. Host tool calls retain their signed callback authorization.

Validated context values retain the existing RPC serialization semantics across the added platform hop, including dates, big integers, maps, and binary values produced by host-schema transformations.

The platform discovers all installation pages and checks selected context readiness before issuing sessions or starting any resolver. A selected error rejects the request; loading returns a loading result. Unsupported or disabled deeper contexts do not prevent an enabled ancestor from resolving. A nearer view without instances blocks fallback through it. Cancelling the host request cancels its platform request and the platform's outstanding app calls. Runtime sessions and credentials are never part of the resolution response.

The resolution phase has one shared 1,000 ms budget, including context decoding, session issuance, cold runtime startup, resolver execution, and response-body reading for every selected app. Discovery and host authentication/validation run before this budget; network travel to the platform is additional. On expiry the platform interrupts the resolution fibers, closes outstanding backend clients, and returns a sanitized 504 `View resolution timed out`, which the host preserves. It returns no partial results and does not retry. Adjust `instanceResolutionTimeoutMs` in `packages/api-platform/src/runtime/view-resolution.ts` to change the limit.

The new platform and host handlers use oRPC's `handlerGen` integration. Effect handles concurrent work, interruption, and backend-client finalization; Promise-based SDK and database calls are adapted at their boundaries.

## Rollout

1. Deploy the additive `/apps/runtime/resolve` platform endpoint. Existing SDKs continue using `/apps/runtime/discover` unchanged.
2. Release the SDK and update hosts. The new SDK makes one platform resolution request and never falls back to calling app backends from the host.
3. Repeat the production benchmark after deployment, including a host outside US East. Keep cold and repeated samples separate.

`views_platform` measures the host's full platform call. `views_discovery` and `views_instances` are platform measurements returned through `Server-Timing`; they are contained within `views_platform`, so do not add all three. Instance timing now includes session issuance as well as resolver execution. Authentication timing remains on the host.

## Baseline collected before this change

`2026-10-22-baseline.json` contains credential-free observations from an Australia/Melbourne browser. The demo host was commit `96b859a` with SDK beta.58; the platform was `4454ea9`. Both Vercel deployments reported `iad1`; responses showed Sydney ingress followed by `iad1`. Fresh anonymous-workspace installations reference the newly published Doom and Messages source app IDs.

The endpoint probes are sequential, use `cache: no-store`, and measure through response-body consumption. Each of the four main `/views` scenarios has 20 successful samples. The samples include the first probe after pauses between batches, so their tails include post-idle effects. These are small diagnostic samples, not a load test or a production service-level estimate. Timing stages overlap: `workspace_auth` is part of `views_auth`, and both are contained within `host`.

The first use of the fresh installation took about 1.61 seconds for page `/views`, including 1.10 seconds in instance resolution. That first-use observation is stored separately from the repeated probes. Initial discovery issued one request each for navbar, panel, and page, concurrently. First navigation to Doom issued one page discovery request, plus navbar discovery, and showed the Doom view after about 1.20 seconds. This measures view visibility, not game-engine startup or first interactive frame.

Repeated page `/views` probes had a median of 471 ms, a nearest-rank p95 of 938 ms, and a 378–987 ms range. The median host duration was 186 ms, including 78 ms for discovery and 96 ms for instance resolution. Authentication-only probes had a 280 ms median, discovery-only probes 371 ms, and panel discovery 352 ms. The first query after pauses repeatedly raised instance-resolution duration; it should be investigated separately from the steady request path.

The existing default-profile workspace still referenced old source deployments after new source apps were published. Updating source app IDs does not migrate existing installations. The JSON also retains five probes against that old installation for comparison; different deployments and workspaces mean this is not a controlled object-location experiment.

The architecture work took priority during benchmarking. Full cold/warm page-load series, warm backend queries and host-tool series, and cross-region host comparisons remain to be measured after the new path is deployed. A single backend query and a single tool call are retained only as diagnostic first samples.
