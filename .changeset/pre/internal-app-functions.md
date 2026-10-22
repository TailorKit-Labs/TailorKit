---
"@patchsmith/app": minor
"@patchsmith/vite": patch
---

Add `.internal()` to app query, mutation, and action builders. Internal functions stay registered for backend execution and are omitted from the typed client API. The runtime rejects direct client calls and subscriptions, including mutation receipt replays, while declared action dependencies and view instance resolvers can call internal queries and mutations.

Backend builds now require the `internal-functions` runtime capability. Deploy the updated apps worker before upgrading the SDK and builder; older workers reject new bundles rather than ignore internal visibility. Existing function definitions remain public by default. Actions continue to call queries and mutations only; this does not add action-to-action calls.
