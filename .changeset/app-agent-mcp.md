---
"@tailorkit/core": minor
"tailorkit": minor
---

Expose app-agent MCP through `server.mcp.handler(request, { scopes, subjectId? })`
and the authenticated host `/mcp` route. Relay the host schema and caller identity
to the platform's native MCP 2026-07-28 endpoint with request-scoped SSE progress.
Provide list, create, and edit tools, with create/edit launching app agents.
