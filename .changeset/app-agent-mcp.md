---
"@tailorkit/core": minor
"tailorkit": minor
---

Expose direct platform MCP access through
`server.mcp.transport({ scopes, subjectId? })`, which returns a URL and headers for
any HTTP MCP client. Provide list, create, and edit tools using MCP 2026-07-28
with request-scoped SSE progress, with create/edit launching app agents.
