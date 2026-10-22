---
"@patchsmith/core": minor
"@patchsmith/cli": minor
"@patchsmith/react": minor
"patchsmith": minor
---

Include a Lucide-backed Icon in the Zod, Valibot and ArkType primitives and matching React primitives. Keep the standalone Icon({ library: "lucide" }) helpers available for overrides and custom component names. Load validated icon geometry on demand from a versioned catalogue, with request deduplication, caching, stable dimensions and decorative accessibility defaults. Hosts can configure a self-hosted catalogue URL or fetch implementation. The hosted catalogue deploys as an independent Cloudflare Static Assets project.

Icon props are limited to a required name and optional size. Runtime schemas and generated bindings accept safe string names so hosts, apps, and platforms can run different compatible SDK versions without rejecting newer icons. Export optional `LucideIconName`, `IconName<"lucide">`, and `IconProps<"lucide">` types for app-local name checking, including from the `patchsmith` root entry point. Generated component types also preserve required fields from their schemas.

Serve icons from `/lucide/v1/<name>.json`, where v1 is the catalogue compatibility version rather than the upstream package version. Generate and commit an additive catalogue snapshot that preserves existing geometry, removed aliases, and license notices across upstream updates and clean deployments. Deploy new assets before apps use new names; missing icons remain empty and retry on later mounts.
