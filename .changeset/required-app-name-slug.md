---
"@tailorkit/vite": minor
"@tailorkit/cli": minor
"tailorkit": minor
---

Require `name` and `slug` in `TailorKitConfig` and validate both when loading app configuration. Add a nonblank display name and a slug containing 1–32 lowercase letters or digits separated by single hyphens to existing `tailorkit.config.ts` files. Deployment uses the configured slug when creating an app; existing linked apps keep their permanent slug. New app scaffolds include both fields using the package name.
