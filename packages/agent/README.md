# TailorKit Agent

A Pi-backed `HarnessAgent` for building and editing TailorKit extensions. The web host, platform chat and MCP routes, and app source export all consume `@tailorkit/agent`; the previous `packages/app-agent` package has been removed.

## Instructions and skills

`src/instructions.md` supplies always-loaded workspace, app structure, runtime, and publishing rules. `src/skills.ts` registers five on-demand harness skills from bundled Markdown: views and file routing, backend functions, SQLite and relations, Preact composition, and Preact performance. The harness projects them into its skill discovery system each turn; app workspaces do not need copies of this repository's `.agents` directory.

The Preact skills adapt the applicable principles from the repository's `vercel-composition-patterns` and `vercel-react-best-practices` skills to generated host components and reactive TailorKit clients. React 19, Next.js, and DOM-specific APIs do not apply. Keep the app guidance aligned with the CLI scaffold, `packages/app/src` public APIs, `packages/vite/src/builder` routing/migrations, and the Durable Object runtime in `apps/apps-worker/src`.

## Durable turns

`@tailorkit/agent/workflows` exports `appAgent(input)`. Start it with `start()` from `workflow/api`; the web host discovers it through `apps/web/workflows/app-agent.ts`. The workflow imports the agent dynamically from its step module. Node APIs, credentials and sandbox objects stay inside steps.

Each turn runs in five-minute slices using `runHarnessAgentTimeSlice()`. Workflow records the returned `continueFrom` checkpoint and reconnects to the same unfinished turn without replaying the prompt. Pi runs in the workflow step’s Node.js process and uses the Vercel sandbox for filesystem and shell tools. There is no sandbox bridge or exposed port. In-process reattachment is disabled: each slice restores Pi’s journal with the current tool context. The VM remains available between slices. Turns have a 30-minute scheduling budget and the VM lifetime is renewed to 15 minutes on each step.

The authorized app ID selects the shared `app-<appId>` source Drive. A separate `threadId` identifies the Pi conversation and its persistent `agent-thread-<threadId>` VM. PostgreSQL stores each thread's opaque resume handle in `app_agent_thread`; the thread's sandbox snapshots retain its Pi journal. Successful turns remove the CLI token file, snapshot/stop the VM, and release the app's editing lease. Switching threads uses the same current app source and each thread's own conversation history.

`app_agent_lease` allows one active writer per app, across all threads. Failed or cancelled runs invalidate and delete only their owning thread's VM; other conversations and the app source survive. An abandoned lease expires after one hour. A new thread can reclaim it, invalidate the abandoned conversation, and clean up its VM. Unknown, foreign-app, interrupted, or cancelled thread IDs are rejected rather than silently starting an empty conversation. Cleanup is owner-checked and remains retryable.

## Threads

Before the model starts, sandbox setup installs `tailorkit@beta` and its matching CLI in `/tmp/tailorkit-cli`. Empty app workspaces are scaffolded as `new-app` in `/workspace/app`, then dependencies are installed and host bindings generated. A setup marker lets interrupted installation or generation resume without overwriting the scaffold. Existing app source is preserved. CLI and new app installs enforce a three-day package release age with immediate availability only for `tailorkit` and `@tailorkit/*`. The agent receives a short readiness note and can begin implementation immediately.

Every new `tailorkit agent --host <url>` invocation starts a new conversation by default. Follow-up messages in that invocation reuse the thread ID announced by the platform in a transient `data-thread` UI chunk. The CLI prints the ID when the chat closes; use `tailorkit agent --host <url> --app <id> --thread <threadId>` to continue it. The resumed TUI shows new messages while Pi retains its native prior context.

MCP `create_app` and `edit_app` create a new thread by default and return its ID in progress events and the terminal result. Pass `threadId` to `edit_app` for a related follow-up. After `create_app`, continue through `edit_app` with the returned app and thread IDs. The backend validates that the requested thread belongs to the authorized app before starting a run or issuing an MCP agent grant.

Direct workflow callers must first authorize the app and call `resolveAppAgentThread(appId, optionalThreadId)` from `@tailorkit/agent/threads`, then pass its result as `AppAgentInput.threadId`. Workflow slices continue the same unfinished turn; separate user-turn runs resume only their explicit thread.

## Setup

Apply the generated `app-agent-sessions` and `agent-threads` migrations with `pnpm db:migrate` against your configured database. Set `DATABASE_URL` and the Vercel Sandbox credentials required by your environment. Model authentication can use AI Gateway (`VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`), direct OpenAI (`OPENAI_API_KEY`), or direct Anthropic (`ANTHROPIC_API_KEY`, optionally `ANTHROPIC_AUTH_TOKEN`). Matching `*_BASE_URL` overrides are optional. Pi receives an isolated authentication record from `@tailorkit/env` and keeps model credentials in the host process. Runtime OIDC is resolved inside each agent execution with `getVercelOidcToken()` because Vercel Functions deliver it through the request context rather than a module-level environment variable. Gateway credentials take precedence; the platform routes still supply the existing Gateway model. Using a direct provider also requires a matching model ID. Gateway model definitions are loaded from its published catalog so models newer than Pi’s bundled registry, including the current MiMo model, remain usable.

The agent exposes Pi’s typed `read`, `write`, `edit`, `bash`, `grep`, `glob`, and `ls` tools through AI SDK tool events, alongside the host-executed `deploy` tool. Deployment retains the platform’s short-lived CLI grant, app authorization, and credential redaction. Native file tools can read the app workspace, supplied schema, and installed CLI; writes stay in the workspace. The token file is denied to native file tools, which does not restrict shell commands. See the [Pi adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi).

Legacy app-wide sessions start fresh threads. The generated migration retains the legacy sandbox name for cleanup when the next editing lease is claimed; app source is preserved.

`run.getReadable<UIMessageChunk>()` already carries AI SDK UI chunks. Consume it directly without `createModelCallToUIChunkTransform()`. The CLI chat keeps running when its response disconnects; the existing MCP transport cancels its agent on disconnect.

## MCP

`@tailorkit/agent/mcp` exports `createAppAgentMcp(backend, scopeNames)`. The backend supplies authorized app operations; the package registers exactly three tools:

- `list_apps`: a paginated, read-only lookup across the caller's authorized scopes.
- `create_app`: creates an app installation and launches an autonomous agent to build and deploy it. Takes `name`, optional `description`, the authorized scope **name**, and `prompt`.
- `edit_app`: launches an autonomous agent to edit and deploy an existing app. Takes `appId`, `prompt`, and optional `threadId`.

The create/edit descriptions explicitly explain that they create agents which write code, run commands, and publish apps. Calls without a thread ID start a new conversation; callers must not automatically retry a disconnected create/edit call. List does not launch an agent.

This endpoint implements **MCP 2026-07-28** using the official SDK v2. Legacy initialization, HTTP+SSE, and protocol sessions are rejected. Responses use request-scoped SSE with keepalives. Clients requesting progress receive `notifications/progress`: `progress` is a monotonically increasing event count, and `message` contains JSON `{ runId, appId, threadId, status? , chunk? }`. `chunk` is an AI SDK UI message chunk. The terminal tool result contains `{ appId, threadId, runId, messages, sessionId, finishReason, usage? }`. The create tool's schema advertises the authorized scope names as an enum.

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
