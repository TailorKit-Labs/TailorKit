---
"@tailorkit/cli": patch
---

Generate component and capability modules behind the existing `#tailorkit` import, with a compact index and focused Markdown references for props, callbacks, slots, context, and tools. Regeneration removes obsolete generated contracts. Keep the generated directory alongside the barrel when copying or committing app source.

Generate a project skill at `.agents/skills/tailorkit-host/SKILL.md` so coding agents can discover these references without TailorKit's hosted-agent instructions. Existing user-authored skills at that path are preserved.

New pnpm projects explicitly allow esbuild's required installation script for Drizzle Kit. Control dependency freshness with `init --minimum-release-age <minutes>` or `PNPM_CONFIG_MINIMUM_RELEASE_AGE`; the default remains three days and `0` accepts new releases. Explicit command-line values take precedence.
