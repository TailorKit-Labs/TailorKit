# TailorKit App Agent

An AI agent for building and editing TailorKit extensions.

## MCP

`@tailorkit/app-agent/mcp` exports `createAppAgentMcp(backend, scopeNames)`. The backend supplies
authorized app operations; the package registers exactly three tools:

- `list_apps`: a paginated, read-only lookup across the caller's authorized scopes.
- `create_app`: creates an app installation and launches an autonomous agent to
  build and deploy it. Takes `name`, optional `description`, the authorized scope
  **name**, and `prompt`.
- `edit_app`: launches an autonomous agent to edit and deploy an existing app.
  Takes `appId` and `prompt`.

The create/edit descriptions explicitly explain that they create agents which
write code, run commands, and publish apps. Each call starts a new agent; callers
must not automatically retry a disconnected create/edit call. List does not
launch an agent.

This endpoint implements **MCP 2026-07-28** using the official SDK v2. Legacy
initialization, HTTP+SSE, and protocol sessions are rejected. Responses use
request-scoped SSE with keepalives. Clients requesting progress receive
`notifications/progress`: `progress` is a monotonically increasing event count,
and `message` contains JSON `{ runId, appId, status? , chunk? }`. `chunk` is an AI
SDK UI message chunk. The terminal tool result contains `{ appId, runId, messages }`.
The create tool's schema advertises the authorized scope names as an enum.

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client(
  { name: "host-agent", version: "1.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL(hostMcpUrl), {
    // Supply credentials accepted by your host's authenticate() implementation.
    requestInit: { headers: { authorization: `Bearer ${hostAccessToken}` } },
  }),
);
const result = await client.callTool(
  { name: "edit_app", arguments: { appId, prompt: "Add a calendar view" } },
  {
    timeout: 35 * 60_000,
    resetTimeoutOnProgress: true,
    onprogress: ({ message }) => renderAgentEvent(JSON.parse(message!)),
  },
);
```

The [current transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
explicitly does **not** support resumable SSE or `Last-Event-ID`. Closing a stream
cancels the request and the platform stops its agent run, deletes the ephemeral
sandbox, and revokes its grant. Successful calls wait for workflow cleanup before
the terminal result. A cancelled create may leave an app installation, and
published changes are not rolled back. Use `list_apps` to inspect the app before
starting a deliberate new call.
