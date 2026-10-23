---
"@patchsmith/app": minor
"@patchsmith/core": minor
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"@patchsmith/client-platform": patch
"patchsmith": minor
---

Add host-defined hooks with typed app handlers discovered from `src/hooks/**/*.hook.ts`. Hosts can discover supporting installations and invoke hooks with validated inputs, outputs, scopes, and hook-specific sessions. Both hook methods accept `scopes` and `subjectId` directly in their options. Handlers can call registered app queries, mutations, actions, and host server tools. Actions can also call other declared actions with the same identity and cancellation lifetime.

Hook names are stored on deployments and exposed through installation metadata, so hosts can discover support without calling app runtimes. Existing deployments and older uploaders default to no hooks; rebuild and republish to advertise hook support.

Hook-enabled builds require a runtime supporting `hooks` and `nested-actions`. Deploy the database migration first, then the updated platform and app runtime before publishing apps with the updated builder. Scheduling and durable retries remain controlled by the host.
