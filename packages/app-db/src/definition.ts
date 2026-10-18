import type { AnyRelations } from "drizzle-orm/relations";

export interface DatabaseDefinition<R extends AnyRelations = AnyRelations> {
  readonly relations: R;
}

/** Configure the installation database with TailorKit relations, including its tables. */
export const defineDatabase = <const R extends AnyRelations>(
  definition: DatabaseDefinition<R>
) => Object.freeze({ relations: definition.relations });
