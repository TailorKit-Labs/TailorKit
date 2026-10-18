import { defineDatabase, defineRelations, table, text } from "#db";
import type { QueryDatabase } from "#db";
import type * as server from "#server";

const users = table("users", { id: text().primaryKey() });
const database = defineDatabase({ relations: defineRelations({ users }) });
declare const db: QueryDatabase<typeof database.relations>;
db.query.users.findMany().sync() satisfies { id: string }[];

true satisfies "defineDatabase" extends keyof typeof server ? false : true;
true satisfies "table" extends keyof typeof server ? false : true;
defineRelations({ users }, (r) => {
  // @ts-expect-error Relation helpers reject unknown tables.
  void r.many.missing;
  return {};
});
// @ts-expect-error Query capabilities cannot write.
void db.insert;
