---
"@tailorkit/vite": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Add an optional `name` to `TailorKitConfig`. Deployment uses it for new apps and synchronizes existing app names while preserving their descriptions. When omitted, new apps retain the package or directory name fallback and existing app names stay unchanged.
