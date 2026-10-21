---
"@patchsmith/client-core": patch
"@patchsmith/react": patch
---

Expose uncached, validated host requests through `createClient().api.apps()` and `createClient().api.views(input)`. Use these Promise-based methods with TanStack Query or another cache, with optional abort signals for cancellation. Existing `useApps` and `useViews` hooks retain their nanostore cache.
