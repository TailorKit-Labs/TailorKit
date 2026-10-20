---
"@patchsmith/ai-sdk": patch
"patchsmith": patch
---

Add `createTools(patchsmith, { scopes, subjectId })` from `patchsmith/ai-sdk` to execute fixed definitions of the app agent's MCP tools with the AI SDK. Use Valibot for tool schemas and validation. Return destructurable `listApps`, `createApp`, and `editApp` tools while retaining snake_case MCP names internally. Stream MCP activity as preliminary tool results, preserve final structured results, and forward cancellation without replaying app changes.
