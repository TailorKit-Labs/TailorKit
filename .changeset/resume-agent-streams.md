---
"@tailorkit/cli": minor
"@tailorkit/core": minor
"@tailorkit/client-platform": minor
---

Reconnect interrupted agent streams to the existing workflow from the last received chunk, and settle a disconnected turn before sending a follow-up. Relay signed run identities and cleanup completion through the host API.

Agent chat requires explicit turn or resume requests. Combine thread and run identity in `data-run`, and require `data-run-complete` after workspace cleanup. Remove the separate `data-thread` event and finish-only success handling.

The app agent checkpoints SDK state directly instead of collecting duplicate model messages. MCP returns the assembled assistant `message` from the output stream instead of a `messages` array.
