---
"@patchsmith/vite": minor
"@patchsmith/cli": minor
"patchsmith": minor
---

Require `name` and `slug` in `PatchsmithConfig` and validate both when loading app configuration. Add a nonblank display name and a slug containing 3–32 lowercase letters or digits separated by single hyphens to existing `patchsmith.config.ts` files. Deployment uses the configured slug when creating an app; existing linked apps keep their permanent slug. New app scaffolds include both fields using the package name, appending `-app` when the derived slug is shorter than three characters.
