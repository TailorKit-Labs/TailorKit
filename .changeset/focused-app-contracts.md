---
"@tailorkit/cli": patch
---

Generate a project skill at `.agents/skills/tailorkit-app/SKILL.md` with a compact index and focused Markdown references in its `references/` directory for props, callbacks, slots, context, styling, and tools. Coding agents can discover the host contract from exported app source. Keep one `tailorkit.gen.ts` for bindings and `#tailorkit` imports; references link to declarations in that file when exact types are needed. Regeneration removes obsolete generated references and preserves user-authored skills.

New pnpm projects explicitly allow esbuild's required installation script for Drizzle Kit. Control dependency freshness with `init --minimum-release-age <minutes>` or `PNPM_CONFIG_MINIMUM_RELEASE_AGE`; the default remains three days and `0` accepts new releases. Explicit command-line values take precedence.
