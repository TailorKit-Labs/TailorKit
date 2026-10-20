---
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Add optional `name` and `description` fields to `TailorKitConfig`. Deployment uses them for new apps and synchronizes configured fields on existing apps. Omitted fields preserve existing values; new apps fall back to the package or directory name and have no description. Set `description: null` to clear it.
