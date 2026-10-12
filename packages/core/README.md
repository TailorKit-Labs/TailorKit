# TailorKit Core

Core functionality for integrating TailorKit into your SaaS.

## App agent MCP

`createServer()` exposes `server.mcp.transport({ scopes, subjectId? })` to prepare
HTTP transport configuration for a server-side MCP client. The options have the
same data shape as the object returned by the host's `authenticate()` callback.
Scope values are validated against the contract's declared Standard Schema
validators. The helper does not call `authenticate()` or require a Request.

```ts
const { url, headers } = await tailorkit.mcp.transport({
  scopes: { org: { tenant: organization.id } },
  subjectId: user.id,
});

// With the AI SDK, for example:
const mcpClient = await createMCPClient({
  transport: { type: "http", url, headers },
});
```

The returned URL points directly to TailorKit's platform MCP endpoint. The
headers contain the configured project credential and an encoded caller context.
These plain values also work with other HTTP MCP clients. Keep them server-side,
create them for the authenticated caller, and do not share them across users.
No host `/mcp` route or proxy handler is mounted.

The helper includes the configured host URL so the builder agent can fetch the
contract from the host's existing `/schema` endpoint when creating/editing an app.
That endpoint must be reachable from the agent's sandbox. Contract schemas are
not placed in HTTP headers. The caller context header is limited to 8 KiB.

Clients must implement MCP 2026-07-28 and request progress notifications to receive
agent events. See [the app-agent protocol and client example](../app-agent/README.md#mcp).
