---
"@tailorkit/app": minor
"@tailorkit/core": minor
"@tailorkit/client-core": minor
"@tailorkit/sandbox": minor
"@tailorkit/cli": minor
"@tailorkit/client-platform": minor
---

Remove legacy session and CLI credential shapes. App sessions now require complete identity metadata, including `identity.subjectId` and `identity.toolUrl`; remove the duplicate top-level subject from host responses and the duplicate top-level tool URL from platform responses. The host forwards the platform session without synthesizing a subject. Share the session validator with the iframe protocol so complete authenticated sessions reach sandboxed apps.

Custom session providers must return `{ expiresAt, identity, token, url }` with a complete identity. Stored CLI credentials must contain a named scope; delete obsolete entries from `~/.tailorkit/auth.json` and log in again to replace flat-scope or scopeless credentials.
