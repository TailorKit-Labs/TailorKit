# TailorKit API Platform

The platform API for managing and running TailorKit extensions.

## App-agent MCP endpoint

`POST /api/platform/app-agent/mcp` is a standard streaming MCP HTTP endpoint implemented by `handleAppAgentMcpRequest` from `@tailorkit/api-platform/app-agent-mcp` and mounted by the web app. Clients connect directly to the platform with a normal MCP JSON-RPC request body and the required MCP metadata headers. Responses use native MCP SSE rather than the oRPC event iterator format.

The host's server-side client supplies two headers:

- `Authorization: Bearer <project key>` authenticates the host. CLI agent JWTs and runtime service credentials cannot use this endpoint.
- `X-TailorKit-Context` carries unpadded base64url-encoded UTF-8 JSON containing `{ scopes, subjectId?, hostUrl }`. It is limited to 8 KiB; invalid encodings, empty scopes, and unexpected context fields are rejected.

`scopes` and optional `subjectId` have the same shape as the object returned by `authenticate()`. They are asserted by the authenticated host. `hostUrl` is the configured public TailorKit host API URL; the builder agent reads its `/schema` endpoint during generation. If an Origin header is present, it must match that host origin. A host proxy is not involved in MCP requests.

The typed `server.mcp.transport({ scopes, subjectId? })` helper prepares the URL and headers, validates the scopes against the host contract, and handles encoding. Clients may also construct these headers directly, using their own MCP library.

App reads, creation, and edits use the authenticated project and exact canonical scope identities. Builder/editor agents receive a one-hour grant for the selected app's scope, using the existing CLI/JWT authorization and revocation checks. The source grant is revoked when the call finishes, fails, or is cancelled. `subjectId`, when supplied, is recorded in workflow attributes for provenance.

See [the MCP tools, streaming contract, and compatibility requirements](../app-agent/README.md#mcp).
