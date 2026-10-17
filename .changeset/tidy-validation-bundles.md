---
"tailorkit": patch
"@tailorkit/app": patch
"@tailorkit/core": patch
"@tailorkit/client-core": patch
"@tailorkit/client-platform": patch
"@tailorkit/vite": patch
"@tailorkit/cli": patch
---

Use Valibot for internal validation to reduce TailorKit bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
