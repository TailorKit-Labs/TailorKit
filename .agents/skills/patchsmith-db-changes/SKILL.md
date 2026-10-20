---
name: patchsmith-db-changes
description: Plan, implement, or review Patchsmith platform schema changes, Drizzle migrations, backfills, and auth-schema changes. Use for separate database PRs and compatibility across backend rollouts. Playground-only SQLite changes follow playground/README.md instead.
---

# Patchsmith database changes

## Deployment and PRs

- Preview environments do **not** use database branches. Check their connection target; treat shared schema and data accordingly. Previews needing new schema must wait until it is deployed to their database.
- Put database changes in their **own PR**: schema, generated migrations/metadata, and directly related relation or validator updates. Stack dependent backend/feature PRs above it, targeting the database branch until it merges. Keep the base PR independently buildable.
- Merge and deploy the database PR first. Backend deployment waits for migrations, but old servers continue running during migration and overlap new servers during rollout. The migrated database must support both versions, including reading each other's writes.
- Preserve compatibility with the previous backend while it remains a rollback target. Defer destructive cleanup to a later database PR after incompatible consumers and rollback targets retire.

## Make changes

1. Read `packages/db/AGENTS.md` for auth generation and relation composition, and `packages/db/drizzle.config.ts` for schema/migration paths. Paths here are relative to the repo root unless linked otherwise.
2. Edit the TypeScript schema. For auth-schema changes, edit Better Auth configuration and run `pnpm --filter @patchsmith/auth generate` first.
3. Run `pnpm db:generate` with the installed Drizzle CLI. Commit schema and generated artifacts together. Review rename prompts against the rollout plan; generated renames can still break old servers.
4. Review the SQL and affected readers/writers using the checklist below. If unsafe, revise the schema or split the rollout and regenerate. **Do not hand-edit generated SQL or snapshots.** Preserve merged/applied migration history; corrections go in new forward migrations. After rebasing, regenerate only this change's unmerged, unapplied artifacts as needed.

When generation cannot express a necessary operation, use `pnpm --filter @patchsmith/db drizzle-kit generate --custom --name=<name>`. Write SQL only in that new custom migration and explain why it is needed. See [Drizzle custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations).

## Review checklist

- Check every SQL statement for drops, renames, type conversions, tightened constraints, rewrites, and blocking index builds.
- Review current deployed readers/writers alongside the new code, including auth, background work, and previews. Old inserts must still succeed; new code must tolerate old rows and ongoing old-version writes. State any uncertainty about the deployed baseline.
- Prefer additive changes, nullable fields or meaningful database defaults, and staged replacements. For backfills, required fields, enum/JSON changes, or large-table operations, read [rollout-patterns.md](references/rollout-patterns.md).
- Base routine compatibility review on SQL and affected code. Add runtime checks only when a concrete uncertainty warrants them; a full compatibility test matrix is not required.

## Deployment handoff

Explain old/new compatibility, deployment order, and any backfill or cleanup follow-up in the database PR. Link dependent PRs to it and retarget/rebase them after it merges.

Production migrations run through `.github/workflows/db-migrate.yml`. Confirm migration success before deploying consumers; keep the existing migration gate. Use tracked migrations for the platform; playground SQLite follows its schema-push workflow. Run local migration commands only against a verified disposable target; shared/production execution stays with the deployment workflow unless explicitly requested.
