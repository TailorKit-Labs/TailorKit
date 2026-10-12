# TailorKit API Platform

The platform API for managing and running TailorKit extensions.

## Host app-agent MCP endpoint

`POST /api/platform/app-agent/mcp` is a streaming HTTP endpoint implemented by
`handleAppAgentMcpRequest` from `@tailorkit/api-platform/app-agent-mcp` and mounted
by the web app. It uses native MCP HTTP responses rather than the oRPC event
iterator format. It accepts the host's project key in `Authorization: Bearer`;
CLI agent JWTs and runtime service credentials cannot use this endpoint.

The host sends a JSON envelope, with the MCP metadata headers preserved:

```json
{
  "scopes": { "org": { "tenant": "one" } },
  "subjectId": "user-one",
  "hostUrl": "https://host.example/api/tailorkit",
  "schema": {},
  "message": { "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
}
```

`scopes` and optional `subjectId` match `authenticate()`'s return value. They are
asserted by the authenticated host, not by an MCP client. `message` is the MCP
JSON-RPC request, including its required `params._meta` envelope; the abbreviated
example omits those MCP fields. `hostUrl` and `schema` come from host configuration.
The standard host relay supplies all of this automatically.

App reads, creation, and edits use the authenticated project and exact canonical
scope identities. Builder/editor agents receive a one-hour grant for the selected
app's scope, using the existing CLI/JWT authorization and revocation checks.
The source grant is revoked when the call finishes, fails, or is cancelled.
`subjectId`, when supplied, is recorded in workflow attributes for provenance.

See [the MCP tools, streaming contract, and compatibility requirements](../app-agent/README.md#mcp).
