# Implementation

- Preserve the host/sandbox boundary: extension code runs in the sandbox; the host renders UI and controls sensitive operations.
- Use `#` aliases for imports between source directories in workspaces that declare `#*`; sibling `./` imports remain allowed. Import other workspaces through their package exports.
- Read environment values through the package's `#env` module. Declare platform environment fields with `createEnv` from `@patchsmith/env`; keep local values in `.env` or `.env.local`.
- Before adding UI, check `packages/ui` and reuse its components. Compose class names with `cn` from `@patchsmith/ui`.
- Change generators or source definitions, then regenerate their output.

# Coding defaults

For JavaScript/TypeScript work, start with these defaults to avoid preventable lint failures:

- Keep precise domain types. Parse untrusted input at I/O boundaries; use named types internally instead of broad `any`, `unknown`, or `object` parameters.
- Prefer type narrowing over assertions and non-null assertions. When an assertion is necessary, add a `// SAFETY:` comment explaining the evidence that makes it valid; keep any required lint suppression local.
- Prefer `const`, destructuring, optional chaining, and nullish coalescing. Use `for...of` for iteration instead of `.forEach()`.
- Prefer `async/await`; await or explicitly handle promises, and use `return await` when returning a promise from an async function. Throw `Error` objects; catch errors when recovering or adding useful context.
- Define React components as module-level arrow functions. Keep hooks unconditional with complete dependencies; use stable keys and nest JSX children between tags.
- Use semantic controls with accessible names, associated input labels, and keyboard interactions. Give buttons an explicit `type`.
- Prefer early returns and named conditions over nested ternaries. Keep regex literals outside loops and avoid spreading accumulators on every iteration.
- Test behavior through real implementations or injected dependencies rather than module mocks. Keep committed tests free of `.only` and `.skip`.

# Verification

- Use pnpm and Vite+ commands: Ultracite 8's standalone CLI does not discover the presets in root `vite.config.ts`.
- Run `pnpm check` for lint and formatting; run `pnpm fix` to apply fixes and review the diff for behavior changes. Focused checks: `pnpm exec vp lint <path>` and `pnpm exec vp fmt --check <path>`.
- For code changes, run affected typechecks and tests through `pnpm exec turbo run check-types test --filter=<workspace>` so dependency builds are included. `pnpm check` covers neither types nor tests.
- Keep preset rules enabled. Keep necessary exceptions local, with suppression comments explaining the runtime or type-system constraint. Preserve explicit `undefined` arguments when argument count matters, even if an autofix suggests removing them.

# Task-specific guidance

- For platform schema, migration, backfill, or auth-schema changes, use the `patchsmith-db-changes` skill for PR separation and rollout compatibility; follow `packages/db/AGENTS.md` for auth generation and relations.
- After changing platform API contracts, run `pnpm --filter @patchsmith/api-platform generate:openapi`, then `pnpm --filter @patchsmith/client-platform generate`.
- For playground setup, contract changes, or database changes, read `playground/README.md` for generation, validator parity, and SQLite schema-push workflows.
- For user-facing public-package changes or release work, read `RELEASING.md` and follow its Changeset and prerelease workflow.

# Dependencies

- Use `workspace:*` for internal dependencies and existing `catalog:` entries for shared external versions in `pnpm-workspace.yaml`.
- Install packages only after at least 3 days have passed since release, unless a required feature or bug fix makes an earlier update necessary. Keep release-age exceptions explicit.
