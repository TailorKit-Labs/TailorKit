# Database migrations

Generate migrations with the Drizzle CLI. Do not hand-write migration SQL unless it is absolutely necessary.

# UI components

Before adding UI, check `packages/ui` and use existing components wherever possible. Use `cn` from `@tailorkit/ui` to compose class names; do not use template literals.

# Package release age

Install packages only after at least 3 days have passed since their release date, unless a required feature or bug fix makes an earlier update necessary.

# Linting and formatting

Use Ultracite’s Oxlint core and React presets and Oxfmt defaults. Keep the custom environment-access restriction in `oxlint.config.ts`.

- Run `pnpm check` to check lint and formatting through Turborepo.
- Run `pnpm fix` to apply fixes, and review the result for behavior changes.
- Run `pnpm exec ultracite doctor` to diagnose the setup.

Do not disable preset rules globally to accommodate new code. Keep any necessary exceptions local and explain the runtime or type-system constraint in the suppression comment. Preserve explicit undefined arguments when argument count matters, even if an autofix suggests removing them.
