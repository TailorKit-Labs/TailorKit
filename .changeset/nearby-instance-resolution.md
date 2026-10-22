---
"@patchsmith/core": minor
"@patchsmith/client-core": minor
"@patchsmith/react": minor
"@patchsmith/client-platform": minor
---

Resolve view instances through one platform request. The host authenticates the viewer and validates view context; the platform discovers scoped installations, issues private runtime sessions, and calls app resolvers concurrently near the runtime. Preserve ancestor selection, context readiness, cancellation, and credential isolation. Breaking: replace `/apps/runtime/discover` with `/apps/runtime/resolve` and remove the old client operation. Deploy the platform and upgrade host SDKs together.

Limit the instance-resolution phase, including session creation and response reading, to one second across all apps. Cancel outstanding calls at the deadline and return completed, validated app results in discovery order. Return a sanitized 504 only when no app completed. Use Effect for resolution orchestration, interruption, and resource cleanup.

Require a warnings array on every ready response, with structured per-app timeout warnings alongside partial results and expose them through view queries and `useViews().warnings`. Complete responses expose an empty warning list in the SDK.
