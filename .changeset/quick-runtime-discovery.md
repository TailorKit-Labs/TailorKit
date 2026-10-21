---
"@patchsmith/core": patch
"@patchsmith/client-platform": patch
---

Reduce `/views` latency by fetching authorized apps and their runtime sessions in one platform request, then resolving instances concurrently without per-app authorization round trips. Runtime credentials remain on the host. Deploy the platform's runtime discovery endpoint before upgrading the SDK.
