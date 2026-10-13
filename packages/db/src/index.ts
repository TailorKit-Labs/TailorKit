import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "#env";

import { relations } from "./relations";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

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

// SAFETY: Every property read is forwarded to the initialized Drizzle instance; the empty proxy target is never used as a connection.
export const db = new Proxy({} as NodePgDatabase<typeof relations>, {
  get(_target, property) {
    const instance = getDb();
    if (!(property in instance)) {
      return;
    }
    // SAFETY: The proxy only forwards keys present on the initialized Drizzle instance.
    const value = instance[property as keyof typeof instance];
    return isFunctionValue(value) ? value.bind(instance) : value;
  },
});

export { isOrgSlugReserved } from "./validate-org-slug";
