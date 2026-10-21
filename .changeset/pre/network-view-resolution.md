---
"@patchsmith/core": minor
"@patchsmith/client-core": minor
"@patchsmith/react": minor
---

Resolve views through a single authenticated host request. The host discovers authorized installations, validates ancestor context and calls the existing compiled instance actions in parallel. View queries no longer request app runtime sessions or call instance actions from the browser.

Breaking: deploy the host and client together to enable `POST /views`. Provider-supplied apps now seed only `useApps`; use `appIds` and `scopes` to filter host view discovery. The direct `slotInstances` transport and the previous `createSlotStore` options are removed. `createPatchsmithFetchClient().views(input)` supports server prefetching with a request-scoped authenticated fetch implementation.
