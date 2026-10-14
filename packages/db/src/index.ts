import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "#env";

import { relations } from "./relations";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

export const createDb = (): NodePgDatabase<typeof relations> => {
  if (
    !(
      env.DATABASE_URL !== undefined &&
      env.DATABASE_URL !== null &&
      env.DATABASE_URL !== ""
    )
  ) {
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
export const db = new Proxy(
  /* oxlint-disable typescript/no-unsafe-type-assertion -- Every property read is forwarded to the initialized Drizzle instance; the empty proxy target is never used as a connection. */
  {} as NodePgDatabase<typeof relations>,
  /* oxlint-enable typescript/no-unsafe-type-assertion */
  {
    get: (_target, property) => {
      const instance = getDb();
      if (!(property in instance)) {
        /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
        return undefined;
      }
      // SAFETY: The proxy only forwards keys present on the initialized Drizzle instance.
      const value =
        instance[
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The proxy only forwards keys present on the initialized Drizzle instance. */
          property as keyof typeof instance
          /* oxlint-enable typescript/no-unsafe-type-assertion */
        ];
      return isFunctionValue(value) ? value.bind(instance) : value;
    },
  }
);

export { isOrgSlugReserved } from "./validate-org-slug";
