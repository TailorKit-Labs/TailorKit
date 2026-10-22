---
"@patchsmith/core": minor
"@patchsmith/cli": minor
"@patchsmith/react": minor
"patchsmith": minor
---

Include a Lucide-backed Icon in the Zod, Valibot and ArkType primitives and matching React primitives. Keep the standalone Icon({ library: "lucide" }) helpers available for overrides and custom component names. Load validated icon geometry on demand from a versioned catalogue, with request deduplication, caching, stable dimensions and decorative accessibility defaults. Hosts can configure a self-hosted catalogue URL or fetch implementation. The hosted catalogue deploys as an independent Cloudflare Static Assets project.

Icon props are limited to a required name and optional size. Generate a Lucide name enum from the pinned catalogue so runtime validators and generated app types reject unknown names. Generated component types also preserve required fields from their schemas.
