---
"@tailorkit/ai-sdk": patch
"tailorkit": patch
---

Add `createTools(tailorkit, { scopes, subjectId })` from `tailorkit/ai-sdk` to execute fixed definitions of the app agent's MCP tools with the AI SDK. Return destructurable `listApps`, `createApp`, and `editApp` tools while retaining snake_case MCP names internally. Stream MCP activity as preliminary tool results, preserve final structured results, and forward cancellation without replaying app changes.
