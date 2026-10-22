---
"@patchsmith/core": patch
"@patchsmith/client-platform": patch
---

Resolve view instances through one platform request. The host authenticates the viewer and validates view context; the platform discovers scoped installations, issues private runtime sessions, and calls app resolvers concurrently near the runtime. Preserve ancestor selection, context readiness, cancellation, and credential isolation. Deploy the additive platform endpoint before upgrading host SDKs.

Limit the instance-resolution phase, including session creation and response reading, to one second across all apps. Cancel outstanding calls and return a sanitized 504 on timeout. Use Effect for resolution orchestration, interruption, and resource cleanup.
