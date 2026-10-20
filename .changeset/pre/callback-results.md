---
"@patchsmith/core": minor
"@patchsmith/app": minor
"@patchsmith/sandbox": minor
"@patchsmith/client-core": minor
"@patchsmith/react": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Return component callback results across the sandbox bridge instead of dropping them. Callback definitions use only input and output schemas. App callbacks accept direct or promised results, and every host callback returns a promise, including callbacks without an output schema. Callback failures, sandbox destruction, and a 30-second timeout reject pending results.
