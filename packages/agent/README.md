# TailorKit Agent

A Pi-backed `HarnessAgent` for building and editing TailorKit extensions. The web host, platform chat and MCP routes, and app source export all consume `@tailorkit/agent`; the previous `packages/app-agent` package has been removed.

## Durable turns

`@tailorkit/agent/workflows` exports `appAgent(input)`. Start it with `start()` from `workflow/api`; the web host discovers it through `apps/web/workflows/app-agent.ts`. The workflow imports the agent dynamically from its step module. Node APIs, credentials and sandbox objects stay inside steps.

Each turn runs in five-minute slices using `runHarnessAgentTimeSlice()`. Workflow records the returned `continueFrom` checkpoint and reconnects to the same unfinished turn without replaying the prompt. Pi runs in the workflow step’s Node.js process and uses the Vercel sandbox for filesystem and shell tools. There is no sandbox bridge or exposed port. In-process reattachment is disabled: each slice restores Pi’s journal with the current tool context. The VM remains available between slices. Turns have a 30-minute scheduling budget and the VM lifetime is renewed to 15 minutes on each step.

The authorized internal app ID identifies both the harness session and `app-agent-<appId>` sandbox. PostgreSQL stores the opaque `resumeFrom` handle in `app_agent_session`; the persistent sandbox snapshots retain Pi's persisted session journal. Successful turns remove the CLI token file, snapshot/stop the VM, and release the app's exclusive editing lease. Later user turns resume both the VM and native conversation. The existing `app-<appId>` Drive retains app source and supports source export.

A database lease excludes concurrent turns before they can share a session. Failed or cancelled runs delete their VM, clear unusable resume state, and retain app files on the Drive. An abandoned lease expires after one hour, beyond both the turn budget and sandbox idle lifetime. Recovery starts a fresh conversation with the existing app source. Cancellation cleanup checks the run owner so it cannot remove another editor's session.

## Setup

Apply the generated `app-agent-sessions` migration with `pnpm db:migrate` against your configured database. Set `DATABASE_URL` and the Vercel Sandbox credentials required by your environment. Model authentication can use AI Gateway (`VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`), direct OpenAI (`OPENAI_API_KEY`), or direct Anthropic (`ANTHROPIC_API_KEY`, optionally `ANTHROPIC_AUTH_TOKEN`). Matching `*_BASE_URL` overrides are optional. Pi receives an isolated authentication record from `@tailorkit/env` and keeps model credentials in the host process. Gateway credentials take precedence; the platform routes still supply the existing Gateway model. Using a direct provider also requires a matching model ID. Gateway model definitions are loaded from its published catalog so models newer than Pi’s bundled registry, including the current MiMo model, remain usable.

The agent exposes Pi’s typed `read`, `write`, `edit`, `bash`, `grep`, `glob`, and `ls` tools through AI SDK tool events, alongside the host-executed `deploy` tool. Deployment retains the platform’s short-lived CLI grant, app authorization, and credential redaction. Native file tools can read the app workspace, supplied schema, and installed CLI; writes stay in the workspace. The token file is denied to native file tools, which does not restrict shell commands. See the [Pi adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi).

Completed fx sessions start a fresh Pi conversation while retaining app source on the Drive. Their native conversation history is not imported.

`run.getReadable<UIMessageChunk>()` already carries AI SDK UI chunks. Consume it directly without `createModelCallToUIChunkTransform()`. The CLI chat keeps running when its response disconnects; the existing MCP transport cancels its agent on disconnect.

## MCP

`@tailorkit/agent/mcp` exports `createAppAgentMcp(backend, scopeNames)`. The backend supplies authorized app operations; the package registers exactly three tools:

- `list_apps`: a paginated, read-only lookup across the caller's authorized scopes.
- `create_app`: creates an app installation and launches an autonomous agent to build and deploy it. Takes `name`, optional `description`, the authorized scope **name**, and `prompt`.
- `edit_app`: launches an autonomous agent to edit and deploy an existing app. Takes `appId` and `prompt`.

The create/edit descriptions explicitly explain that they create agents which write code, run commands, and publish apps. Each call starts a new agent; callers must not automatically retry a disconnected create/edit call. List does not launch an agent.

This endpoint implements **MCP 2026-07-28** using the official SDK v2. Legacy initialization, HTTP+SSE, and protocol sessions are rejected. Responses use request-scoped SSE with keepalives. Clients requesting progress receive `notifications/progress`: `progress` is a monotonically increasing event count, and `message` contains JSON `{ runId, appId, status? , chunk? }`. `chunk` is an AI SDK UI message chunk. The terminal tool result contains `{ appId, runId, messages, sessionId, finishReason, usage? }`. The create tool's schema advertises the authorized scope names as an enum.

```ts
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const { url: platformMcpUrl, headers } = await tailorkit.mcp.transport({
  scopes,
  subjectId,
});
const client = new Client(
  { name: "host-agent", version: "1.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } }
);
await client.connect(
  new StreamableHTTPClientTransport(new URL(platformMcpUrl), {
    // URL and headers from await tailorkit.mcp.transport({ scopes, subjectId }).
    requestInit: { headers },
  })
);
const result = await client.callTool(
  { name: "edit_app", arguments: { appId, prompt: "Add a calendar view" } },
  {
    timeout: 35 * 60_000,
    resetTimeoutOnProgress: true,
    onprogress: ({ message }) => renderAgentEvent(JSON.parse(message!)),
  }
);
```

The [current transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) explicitly does **not** support resumable SSE or `Last-Event-ID`. Closing a stream cancels the request and the platform attempts to stop its agent run and delete its sandbox and clear its resume state, then revokes its grant. Stream and progress failures use the same cleanup. If sandbox deletion fails, its idle timeout releases it; process interruption can leave cleanup to the grant expiry and sandbox timeout. Successful calls wait for workflow cleanup before the terminal result. A cancelled create may leave an app installation, and published changes are not rolled back. Use `list_apps` to inspect the app before starting a deliberate new call.
