---
"@tailorkit/client-platform": major
"@tailorkit/core": patch
"@tailorkit/cli": patch
---

Add immutable, project-scoped app slugs and expose them in app responses. Apps and installations can choose a slug at creation; omitted slugs receive a stable generated username.

Platform app operations now require an explicit `app: { id }`, `app: { shortId }`, or `app: { slug }` selector instead of guessing an identifier namespace. App operations use POST endpoints with the selector in the body. Deployment creation/listing and agent chat use the same selector. Update the platform client, host, and CLI together with the backend.
