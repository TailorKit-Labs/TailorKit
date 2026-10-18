import { defineRelations as drizzleDefineRelations } from "drizzle-orm";
import type {
  ExtractTablesWithRelations,
  RelationsBuilder,
  RelationsBuilderConfig,
} from "drizzle-orm/relations";
import type { SQLiteTable, SQLiteView } from "drizzle-orm/sqlite-core";

/** Tables available to an app's installation database. */
export type DatabaseSchema = Record<string, SQLiteTable | SQLiteView>;

/** TailorKit's typed navigation helpers for the configured tables. */
export type RelationHelpers<S extends DatabaseSchema> = RelationsBuilder<S>;
export type RelationConfig<S extends DatabaseSchema> =
  RelationsBuilderConfig<S>;

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- A schema without navigation still includes every table, with no relation keys.
type NoRelations = Record<never, never>;

/** Include every table, optionally defining one/many navigation between them. */
export function defineRelations<S extends DatabaseSchema>(
  schema: S
): ExtractTablesWithRelations<NoRelations, S>;
export function defineRelations<
  S extends DatabaseSchema,
  C extends RelationConfig<S>,
>(
  schema: S,
  relations: (helpers: RelationHelpers<S>) => C
): ExtractTablesWithRelations<C, S>;
export function defineRelations<
  S extends DatabaseSchema,
  C extends RelationConfig<S>,
>(schema: S, relations?: (helpers: RelationHelpers<S>) => C) {
  if (relations) {
    return drizzleDefineRelations<S, C, S>(schema, relations);
  }
  return drizzleDefineRelations<S, S>(schema);
}
