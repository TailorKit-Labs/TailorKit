import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import * as schema from "@patchsmith/db/schema/auth";
import type { SecondaryStorage } from "better-auth";
import { betterAuth } from "better-auth/minimal";

/** Both platform backends must use the same key namespace and storage policy. */
export const projectHostKeys = (secondaryStorage?: SecondaryStorage) =>
  apiKey({
    configId: "project-host",
    defaultPrefix: "tk_proj_",
    enableMetadata: true,
    keyExpiration: {
      defaultExpiresIn: null,
      maxExpiresIn: 3650,
      minExpiresIn: 0,
    },
    references: "organization",
    ...(secondaryStorage
      ? { fallbackToDatabase: true, storage: "secondary-storage" as const }
      : { storage: "database" as const }),
  });

/** Minimal server API only; its HTTP authentication routes are never exposed. */
export const createProjectHostVerifier = (options: {
  database: Parameters<typeof drizzleAdapter>[0];
  secret: string;
  baseURL: string;
  secondaryStorage: SecondaryStorage;
}) =>
  betterAuth({
    advanced: { database: { generateId: "uuid", joins: true } },
    baseURL: options.baseURL,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    plugins: [projectHostKeys(options.secondaryStorage)],
    secondaryStorage: options.secondaryStorage,
    secret: options.secret,
  });
