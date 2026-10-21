---
"@patchsmith/client-core": minor
"@patchsmith/react": patch
---

Expose uncached, validated host requests through `createClient().api.apps()` and `createClient().api.views(input)`. Use these Promise-based methods with TanStack Query or another cache, with an optional `signal` field for cancellation. Both endpoints accept a single options object; standalone `createEndpointClient` callers should replace positional signal arguments with `apps({ signal })` and `views({ ...input, signal })`. Existing `useApps` and `useViews` hooks retain their nanostore cache.
