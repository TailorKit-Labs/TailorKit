# TailorKit AI SDK tools

Use `createTailorKitTools` from `tailorkit/ai-sdk` (or `@tailorkit/ai-sdk`) to let an AI SDK model list, create, and edit TailorKit apps through the app agent's MCP endpoint. Requires AI SDK 7 and Node.js 22 or newer.

Create the tools on your host server for each authenticated request. Pass the transport returned by your TailorKit server's `mcp.transport` method. It carries the project credential, authorized scopes, host URL, and user identity. Keep this configuration on the server.

```ts
import { streamText } from "ai";
import { createTailorKitTools } from "tailorkit/ai-sdk";

// server, user, model, and messages come from your host application.
const adapter = await createTailorKitTools({
  ...(await server.mcp.transport({
    scopes: { org: { tenant: user.organizationId } },
    subjectId: user.id,
  })),
  abortSignal: request.signal,
});

try {
  const response = streamText({
    model,
    messages,
    tools: adapter.tools,
    onEnd: adapter.close,
    onAbort: adapter.close,
    onError: adapter.close,
  });
  return response.toUIMessageStreamResponse();
} catch (error) {
  await adapter.close();
  throw error;
}
```

The adapter discovers tool descriptions and input schemas from MCP, including the host-authorized scopes for `create_app`. It calls `/app-agent/mcp` directly using MCP 2026-07-28. It does not call the chat or AI SDK agent endpoints. The host retains control over credentials and authorization; these are never model arguments.

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

`generateText` also works: await generation and close the adapter in `finally`. It consumes progress and returns the final tool output. For streaming, close only after the stream finishes, aborts, or errors; closing immediately after `streamText()` interrupts tool execution. `close()` can be called more than once.

The AI SDK tool abort signal and the adapter's optional `abortSignal` cancel in-flight MCP requests. `timeoutMs` controls inactivity (default 60 seconds, reset by progress), and `maxTotalTimeoutMs` limits each tool call (default 30 minutes). You can supply `fetch` for custom HTTP handling.

MCP tool errors and transport failures become AI SDK tool errors. The adapter does not replay failed app changes. Check the app before retrying a disconnected create or edit operation. Each concurrent call has its own progress and cancellation state.
