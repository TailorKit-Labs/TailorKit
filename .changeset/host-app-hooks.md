---
"@patchsmith/app": minor
"@patchsmith/core": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"@patchsmith/client-platform": patch
"patchsmith": minor
---

Add host-defined hooks with typed app handlers discovered from `src/hooks/**/*.hook.ts`. Hosts can discover supporting installations and invoke hooks with validated inputs, outputs, scopes, and hook-specific sessions. Hooks can only be invoked by the host, not through nested action calls. Both hook methods accept `scopes` and `subjectId` directly in their options. App authors use `defineHook`; hook registration stays in the builder-only internal server entry point. Handlers can call registered app queries, mutations, actions, and host server tools. Actions can also call other declared actions with the same identity and cancellation lifetime.

Synchronous schema serialization treats asynchronous validators as required in generated hook and view bindings.

Hook names are stored on deployments and exposed through installation metadata, so hosts can discover support without calling app runtimes. Existing deployments and older uploaders default to no hooks; rebuild and republish to advertise hook support.

All rebuilt server bundles require a runtime supporting `nested-actions`; hook-enabled builds also require `hooks`. Older runtimes reject these bundles, including apps without hooks. Deploy the database migration first, then the updated platform and app runtime before publishing the updated SDK or rebuilding apps. Scheduling and durable retries remain controlled by the host.
