# TailorKit Core

Core functionality for integrating TailorKit into your SaaS.

## App agent MCP

`createServer()` exposes `server.mcp.handler(request, context)` for a caller that
has already been authenticated. `context` is the same data your `authenticate()`
callback returns: `{ scopes, subjectId? }`. Scope values are validated against
the contract's declared Standard Schema validators before any platform request.

```ts
const identity = await authenticate({ request });
if (!identity) return new Response("Unauthorized", { status: 401 });
return server.mcp.handler(request, identity);
```

The normal `server.handler(request, { authenticate })` also serves MCP at
`<baseUrl>/mcp`. It calls `authenticate()` and passes its result to the same relay.
Both entry points accept POST with MCP JSON-RPC and the required protocol headers.
The relay supplies the configured host URL and serialized contract schema, uses
the server's project key, and forwards the streaming response without buffering.
Tool arguments cannot select caller scope identities or a subject. Requests with
an Origin must match the configured host origin.

Clients must implement MCP 2026-07-28 and request progress notifications to receive
agent events. See [the app-agent protocol and client example](../app-agent/README.md#mcp).
