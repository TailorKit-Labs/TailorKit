# TailorKit AI SDK tools

Use `createTools` from `tailorkit/ai-sdk` (or `@tailorkit/ai-sdk`) to let an AI SDK model list, create, and edit TailorKit apps through the app agent's MCP endpoint. Requires AI SDK 7 and Node.js 22 or newer.

Create the tools on your host server for each authenticated request. Pass your configured TailorKit server and the same `scopes` and `subjectId` context used by the host SDK. Scope values are checked against your server's configured schemas before each MCP call. Credentials and authorization stay on the host.

```ts
import { streamText } from "ai";
import { createTools } from "tailorkit/ai-sdk";

// tailorkit, user, model, and messages come from your host application.
const tools = createTools(tailorkit, {
  scopes: { org: { tenant: user.organizationId } },
  subjectId: user.id,
});

return streamText({
  model,
  messages,
  tools,
  abortSignal: request.signal,
}).toUIMessageStreamResponse();
```

`createTools` is synchronous and returns `list_apps`, `create_app`, and `edit_app` directly. The tool names, descriptions, and schemas are fixed; the adapter does not perform MCP tool discovery. `create_app` limits its scope name to the scopes supplied by the host. Each invocation obtains authenticated transport configuration from the TailorKit server, calls `/app-agent/mcp` using MCP 2026-07-28, and closes its own connection when it finishes or fails.

Each MCP activity notification produces an AI SDK preliminary tool result:

```ts
{ status: "running", progress: { progress: 1, message: "Building the app" } }
```

The final tool result contains the original MCP result, including `content` and `structuredContent`:

```ts
{
  status: "completed",
  result: {
    content: [{ type: "text", text: "Published the app." }],
    structuredContent: {
      answer: "Published the app.",
      appId: "...",
      runId: "...",
      threadId: "...",
      finishReason: "stop",
    },
  },
}
```

Render preliminary outputs while the tool part has `preliminary: true`. Progress consists of bounded activity snapshots from MCP, rather than raw agent token or internal tool streams. A slow consumer receives the latest snapshot. Use a returned `threadId` with `edit_app` to continue the same app conversation.

`generateText` also works with the same tools: it consumes progress and returns the final tool output. No explicit connection setup or cleanup is needed.

Pass `abortSignal` to your AI SDK generation call to cancel in-flight MCP requests. Calls have a 60-second inactivity timeout reset by progress and a 30-minute absolute limit.

Missing tools, invalid results, MCP tool errors, and transport failures become AI SDK tool errors. The adapter does not replay failed app changes. Check the app before retrying a disconnected create or edit operation. Each concurrent call has its own connection, progress, and cancellation state.
