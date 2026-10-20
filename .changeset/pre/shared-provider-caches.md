---
"@patchsmith/react": minor
"@patchsmith/client-core": minor
"@patchsmith/app": minor
"patchsmith": minor
---

Remove the React provider's `subjectId` prop and subject-based cache partitioning and remounting. Providers share their client cache, and backend sessions are cached per app until renewal or an explicit refresh. Remove the session provider's subject cache key and the endpoint client's `setSubject` method; authenticated subject identity continues to come from the server.

Expose `client.clearCache()` to clear shared app data and backend sessions after host authentication changes.
