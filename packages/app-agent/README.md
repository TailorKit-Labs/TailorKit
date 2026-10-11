# TailorKit App Agent

An AI agent for building and editing TailorKit extensions.

The hosted MCP endpoint is `POST /api/platform/app-agent/mcp` on the web app. It
wraps the existing app-building workflow so another agent can delegate a complete
task to an app sub-agent in a persistent sandbox.

Connect using Streamable HTTP with both headers:

```text
Authorization: Bearer <project host API key>
X-TailorKit-Deploy-Token: <CLI deploy token for the target scope>
```

Use the existing project host key and CLI login flow to obtain these credentials.
The deploy token binds every tool to one scope; the caller cannot select another
scope through tool arguments. Credentials are validated on every HTTP request,
including discovery, and are never passed to the sub-agent. Internal runtime
credentials cannot invoke this endpoint.

| Tool          | Behavior                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_apps`   | Lists apps in the authenticated project and scope. Supports `page` and `pageSize`.                                                  |
| `create_app`  | Creates an app record and starts a **new sub-agent**. Requires `name`, `prompt`, and `hostUrl`; accepts `description` and `schema`. |
| `edit_app`    | Starts a **new sub-agent** in an existing app's persistent workspace. Requires `appId`, `prompt`, and `hostUrl`; accepts `schema`.  |
| `get_app_run` | Observes an existing sub-agent using `appId`, `runId`, and `cursor`. Never starts another run.                                      |

`hostUrl` is the host's TailorKit API URL, usually ending in `/api/tailorkit`, not
the MCP endpoint. Every editing turn needs it to generate bindings for the actual host.
Supply the optional serialized `schema` when the host is local or unreachable
from the sandbox; the workflow writes it into the sandbox for CLI generation. Prompts should
include the requested pages, behavior, and constraints; each editing turn starts
with this task and inspects the existing workspace.

Editing and observation calls wait up to `waitSeconds` (default 25, maximum 25;
use 0 for an immediate snapshot). They return structured content and a matching
JSON text result containing `appId`, `runId`, `status`, `cursor`, `events`, and
`hasMore`. Completed runs also include the sub-agent's final `summary`; failed
runs return `isError: true` and an `error` with the same run handle. Creating an
app whose workflow cannot be enqueued returns the app ID so it can be retried
with `edit_app`.

If observation itself fails, the response retains the run handle with status
`unknown`; retry `get_app_run` to check the workflow rather than starting another
sub-agent.

Pass the returned cursor to `get_app_run` while status is `pending` or `running`,
or while `hasMore` is true. Each reply consumes at most 200 workflow chunks.
Do not repeat `create_app` or `edit_app` to poll: they start new sub-agents.
Only one sub-agent can write to an app at a time. Disconnecting detaches the
observer; the durable workflow keeps running. Store the app/run IDs from the
reply or progress metadata to reconnect. If a connection is lost before either
is received, the caller has no run handle; requests are not idempotent.

MCP clients that request progress with `_meta.progressToken` receive standard
`notifications/progress` on the POST's SSE response. Messages identify the app
sub-agent and include its text, tool activity, step resets, and errors. The
notification's `_meta` includes the app ID, run ID, cursor, and event. Clients
decide whether and how to display notifications; `events` and the final summary
remain available to clients that do not display progress. Reasoning and tool
arguments/results are not included in these progress events. A reset event means
the current model step is being retried and its partial text should be discarded.

For example, an agent using the MCP SDK can connect and observe a delegated task:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "parent-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(
    new URL("https://your-platform.example/api/platform/app-agent/mcp"),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${projectHostKey}`,
          "X-TailorKit-Deploy-Token": deployToken,
        },
      },
    },
  ),
);

const delegated = await client.callTool(
  {
    name: "create_app",
    arguments: {
      name: "Notes",
      prompt: "Create a notes app with a list page and an editor using the host contract.",
      hostUrl: "https://your-host.example/api/tailorkit",
    },
  },
  undefined,
  {
    onprogress: ({ message }) => showSubAgentProgress(message),
  },
);
// Inspect delegated.structuredContent. Continue with get_app_run using the
// returned appId, runId, and cursor until it finishes and hasMore is false.
await client.close();
```

The MCP server implementation is exported from `@tailorkit/app-agent/mcp`.
`createAppAgentMcpServer` accepts an authorized backend for other transports;
`handleAppAgentMcpRequest` provides the stateless HTTP transport. The platform
adapter handles credentials, existing app APIs, and durable workflow ownership.
No process-local sessions are needed. GET and DELETE return 405; observation
resumes through `get_app_run`, not a separate SSE session.

Builds and source remain in the app's workspace. Publishing is not connected;
`published: false` is returned even after successful local checks. A completed
workflow has finished its sandbox cleanup, allowing the next editing turn.
