---
"@patchsmith/vite": patch
---

Expose the config app-ID updater at `@patchsmith/vite/config/app-link` so the fx deploy tool can persist the existing app identity before verification and publication, using the same config editing logic as the CLI.
