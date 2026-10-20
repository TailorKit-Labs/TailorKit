---
"@patchsmith/cli": minor
"@patchsmith/client-platform": minor
---

Start a new agent conversation for each CLI invocation by default. Follow-up messages reuse its thread, and `patchsmith agent --thread <id>` explicitly resumes a previous conversation. Add optional `threadId` to the chat protocol and return thread metadata in the stream.
