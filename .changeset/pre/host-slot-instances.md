---
"@patchsmith/react": minor
"@patchsmith/core": minor
"@patchsmith/app": patch
"@patchsmith/cli": patch
"@patchsmith/client-platform": patch
"@patchsmith/sandbox": patch
"patchsmith": minor
---

Add client-bound `useSlotInstances({ app, slot })` to fetch instances through the authenticated app action endpoint using the matching view and registered ancestor context. Expose loading, errors, and refetch; clear stale data when context or deployment changes. Preserve disabled view paths in manifests so host matching respects blocked fallback, while keeping them out of `useViews` discovery.
