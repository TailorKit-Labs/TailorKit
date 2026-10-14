# Database rollout and design

## Replace or remove a field/table

Use **expand, migrate, contract**:

1. Add the replacement while preserving the original schema and behavior. Deploy this database PR first.
2. Stack the backend change above it. During overlap, tolerate absent replacement values and preserve the representation old readers need. Choose synchronization explicitly: new-code dual writes alone do not capture old-code writes, so use a compatible read fallback, deliberate database synchronization, or delay the final switch until old writers retire.
3. Backfill existing data with bounded, resumable, idempotent batches. Avoid overwriting newer writes. Reconcile after old writers retire and verify completion using explicit counts/invariants.
4. Switch reads and stop using the legacy representation in a compatible backend release. Retain synchronization while supported old readers still need it.
5. Drop the legacy field/table in a later database PR only after all consumers and rollback targets that require it have retired.

An in-place rename, drop, or narrowing conversion usually cannot satisfy step 1. A generated migration containing one is a reason to revisit the plan.

## New required fields and constraints

Old code will omit new fields on inserts. Start with a nullable field or a semantically correct **database** default; an ORM-only default in new code cannot protect old writers. Keep the application tolerant of existing rows until backfill completes. Apply `NOT NULL` or stricter checks only when existing data and every active writer satisfy them.

Preflight nulls, duplicates, and orphans before tightening constraints. Account for writes occurring between preflight and enforcement. For populated tables, consider staged constraint validation where PostgreSQL supports it; `NOT VALID` still checks new writes, so old-writer compatibility remains necessary. Review lock levels, validation scans, and rewrite costs in the [PostgreSQL ALTER TABLE reference](https://www.postgresql.org/docs/current/sql-altertable.html).

Separate long-running backfills from deployment-gating DDL. Define checkpoints, retry behavior, batch bounds, completion queries, and who/what runs the backfill; do not make a schema migration wait on an unbounded full-table update.

## Enum and JSON compatibility

Database acceptance does not imply backend acceptance. Old validators and exhaustive branches may reject a new enum value or JSON shape. Deploy tolerant readers before emitting new representations, preserve existing meanings, and treat renames/removals as staged replacements.

## Tenant boundaries and integrity

- Match ownership to the existing organization/project/app/scope model. Scope uniqueness to the owner when identity is tenant-local. Prevent cross-owner references through appropriate database constraints and/or verified ownership checks; a foreign key to an ID alone does not prove shared ownership.
- Preserve canonical scope identity (`scopeKey` and scope JSON); treat changes to its derivation as data and authorization migrations.
- Enforce durable invariants with foreign keys, unique constraints, and checks where expressible. Drizzle query relations are not substitutes for database foreign keys, and application validation alone does not cover concurrent writers. Choose `cascade`, `restrict`, or `set null` according to lifecycle semantics. See [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
- Follow neighboring ID, timestamp, naming, and validator conventions. Distinguish internal IDs from public identifiers and preserve public identity stability.

## Indexes and transactions

Choose indexes from actual predicates, joins, ordering, and owner scope; inspect existing indexes before adding another. Review referencing-column indexes when adding foreign keys. Include write/storage costs and representative query plans in decisions for large tables.

Review index creation's effect on active writes. PostgreSQL's `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block; verify the installed migration runner's transaction behavior before selecting it. Plan for interrupted builds and invalid indexes. Use a tested execution path rather than inserting concurrent DDL into generated SQL. See [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html).

Use transactions for multi-row invariants; use database constraints or atomic conditional writes to resolve races. An application-level check followed by an insert/update is not sufficient concurrency protection. Keep lock-holding transactions short and use consistent lock ordering where multiple rows are involved.
