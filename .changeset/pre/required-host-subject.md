---
"@patchsmith/app": minor
"@patchsmith/core": minor
"@patchsmith/sandbox": minor
"@patchsmith/client-platform": minor
---

Require a nonempty `subjectId` in authenticated host contexts, MCP transports, backend sessions, and signed app/tool credentials. App functions and host tools can now rely on `identity.subjectId` being a string.

Update every host `authenticate()` callback and `server.mcp.transport()` call to supply the authenticated user's stable ID, or a stable service-principal ID for automation. Values must contain 1–256 characters. Return `null` for unauthenticated callers; client-provided IDs and installation-ID fallbacks do not establish a principal.

Upgrade host integrations before enforcing the new platform/runtime contracts. Existing sessions and signed credentials without a subject are rejected and must be reissued after the host is updated.
