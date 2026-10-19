---
"patchsmith": patch
"@patchsmith/app": patch
"@patchsmith/client-platform": patch
"@patchsmith/core": patch
"@patchsmith/react": patch
"@patchsmith/sandbox": patch
---

Include development export targets in published packages so Vite consumers do not need custom resolution conditions. Expose app authoring from `tailorkit/app` and `tailorkit/app/config`.
