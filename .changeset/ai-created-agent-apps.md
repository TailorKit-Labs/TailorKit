---
"@tailorkit/cli": patch
"@tailorkit/core": patch
"@tailorkit/client-platform": patch
---

Restrict the agent command to apps created by AI, validate explicit app IDs, and mark apps created through the authenticated agent creation flow as AI-created. Reject caller-supplied provenance on general app creation.
