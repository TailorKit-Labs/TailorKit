# Database migrations

Generate migrations with the Drizzle CLI. Do not hand-write migration SQL unless it is absolutely necessary.

# UI components

Before adding UI, check `packages/ui` and use existing components wherever possible. Use `cn` from `@tailorkit/ui` to compose class names; do not use template literals.

# Package release age

Install packages only after at least 3 days have passed since their release date, unless a required feature or bug fix makes an earlier update necessary.

# Linting and formatting

Use Ultracite’s Oxlint core and Anti-Slop presets and Oxfmt defaults through the root `vite.config.ts`. Framework presets are scoped with `lint.overrides`: React for UI and React/Preact workspaces, and React plus TanStack for the web hosts, and shadcn only for `apps/web`. Keep the custom environment-access restriction in that config.

- Run `pnpm check` to check lint and formatting through Turborepo.
- Run `pnpm fix` to apply fixes, and review the result for behavior changes.
- Run `pnpm exec vp lint` and `pnpm exec vp fmt --check` for individual checks.
- Use Vite+ commands: Ultracite 8’s standalone CLI does not discover presets stored in `vite.config.ts`.

Do not disable preset rules globally to accommodate new code. Keep any necessary exceptions local and explain the runtime or type-system constraint in the suppression comment. Preserve explicit undefined arguments when argument count matters, even if an autofix suggests removing them.
