---
"@patchsmith/app": minor
"@patchsmith/vite": minor
"@patchsmith/core": patch
"@patchsmith/client-platform": patch
"patchsmith": minor
---

Add `instances.cache: "static"` to evaluate instance resolvers during the build, validate their JSON-compatible output, and publish the snapshot with the deployment. The platform resolves static entries without an app runtime session or Cloudflare resolver call. Omitted cache policies and `cache: "none"` retain runtime resolution; client response caching is unchanged.

Static resolvers take no request arguments and are excluded from deployed bundles. Deploy platform and host support before publishing apps that use static instances.
