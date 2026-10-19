# TailorKit core

Use `@tailorkit/core` to define a host contract and connect your server to TailorKit.

## Connect an app agent over MCP

`createServer()` exposes `server.mcp.transport({ scopes, subjectId })` to prepare an HTTP connection for a server-side Model Context Protocol (MCP) client. Pass the same data shape returned by your host’s `authenticate()` callback. The helper validates scope values against the contract’s Standard Schema validators; it does not call `authenticate()` or require a `Request`.

For example, use the returned URL and headers with the AI SDK’s `createMCPClient`:

```ts
const { url, headers } = await tailorkit.mcp.transport({
  scopes: { org: { tenant: organization.id } },
  subjectId: user.id,
});

const mcpClient = await createMCPClient({
  transport: { type: "http", url, headers },
});
```

The URL points directly to TailorKit’s platform MCP endpoint. The headers contain your project credential and encoded caller context. These values also work with other HTTP MCP clients.

Keep the headers server-side and create them for each authenticated caller. They contain the project secret and must never reach browsers or untrusted clients. Scopes describe the trusted host’s caller context for the request. The helper does not mount a host `/mcp` route or proxy handler.

The helper includes the configured host URL so the builder agent can fetch its `/schema` endpoint when creating or editing an app. That endpoint must be reachable from the agent’s sandbox. Contract schemas stay out of HTTP headers; the caller context header has an 8 KiB limit.

Clients must implement MCP 2026-07-28 and request progress notifications to receive agent events. See the [app-agent protocol and client example](../agent/README.md#mcp).
