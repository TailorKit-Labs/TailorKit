import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "#env";

import { relations } from "./relations";

export const createDb = (): NodePgDatabase<typeof relations> => {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to create a database connection."
    );
  }

  return drizzle(env.DATABASE_URL, { relations });
};

let dbInstance: NodePgDatabase<typeof relations> | undefined;

const getDb = (): NodePgDatabase<typeof relations> =>
  (dbInstance ??= createDb());

export const db = new Proxy({} as NodePgDatabase<typeof relations>, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { isOrgSlugReserved } from "./validate-org-slug";
