# TailorKit core

Use `@tailorkit/core` to define a host contract and connect your server to TailorKit.

## Connect an app agent over MCP

`createServer()` exposes `server.mcp.transport({ scopes, subjectId? })` to prepare an HTTP connection for a server-side Model Context Protocol (MCP) client. Pass the same data shape returned by your host’s `authenticate()` callback. The helper validates scope values against the contract’s Standard Schema validators; it does not call `authenticate()` or require a `Request`.

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

## Install a deployed app (experimental)

Call `tailorkit.experimental.installApp()` on the server returned by `createServer()`:

```ts
const installed = await tailorkit.experimental.installApp({
  appId: "deployed_app_id",
  scope: { name: "org", value: { tenant: organization.id } },
});
```

`appId` accepts a public app ID or UUID in the same TailorKit project. `scope.name` and `scope.value` are inferred from your contract's scope validators. The SDK validates and serializes the scope before sending the request with your configured `projectKey`.

Call this from your trusted backend after checking the caller can install into the target scope. It does not call `authenticate()` or expose an installation route to browsers. Agent and CLI deployment credentials cannot use this operation.

Each call creates a new installation and returns its app record, including its ID, published deployment, views, and asset URLs. The installation has its own scope and runtime data, and appears in the existing apps endpoint for that scope. It shares the source's published code and logos; it does not copy app data or agent conversations. Future source deployments do not update existing installations. An app without a current published deployment cannot be installed.

The source deployment is retained by a database reference while installations use it. Deleting its source app is therefore blocked until those installations are removed. This API is experimental and may change outside semantic versioning.
