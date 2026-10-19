---
"@tailorkit/cli": patch
---

Generate a project skill at `.agents/skills/tailorkit-capabilities/SKILL.md` with a compact index and focused Markdown references in its `references/` directory for props, callbacks, slots, context, styling, and tools. Coding agents can discover the host contract from exported app source. Keep one `tailorkit.gen.ts` for bindings and `#tailorkit` imports; references link to declarations in that file when exact types are needed. Regeneration removes obsolete generated references and preserves user-authored skills.

New pnpm projects explicitly allow esbuild's required installation script for Drizzle Kit. Keep the three-day minimum release age for third-party dependencies and exempt only `tailorkit` and `@tailorkit/*` through `minimumReleaseAgeExclude` so new TailorKit releases can be installed immediately.

Include schema-specific component, callback, responsive styling, tool-call, and view-registration examples in generated references, and mark required props explicitly.
