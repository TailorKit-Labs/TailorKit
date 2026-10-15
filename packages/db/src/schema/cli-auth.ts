import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import type z from "zod";

import { project } from "./project";
import { scopeKeySchema, scopeSchema } from "./scope";
import type { Scope } from "./scope";

export const cliAuthSessionStatus = pgEnum("cli_auth_session_status", [
  "pending",
  "approved",
  "denied",
]);

export const cliToken = pgTable(
  "cli_token",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),

    expiresAt: timestamp("expires_at").notNull(),

    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),

    lastUsedAt: timestamp("last_used_at"),

    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),

    revokedAt: timestamp("revoked_at"),

    scope: jsonb("scope_json").$type<Scope>().notNull(),

    scopeKey: text("scope_key").notNull(),

    tokenHash: text("token_hash").notNull(),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cli_token_project_scope_key_idx").on(
      table.projectId,
      table.scopeKey
    ),
    index("cli_token_expires_at_idx").on(table.expiresAt),
    index("cli_token_revoked_at_idx").on(table.revokedAt),
    uniqueIndex("cli_token_token_hash_unique").on(table.tokenHash),
  ]
);

export const cliAuthSession = pgTable(
  "cli_auth_session",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),

    deviceCodeHash: text("device_code_hash").notNull(),

    expiresAt: timestamp("expires_at").notNull(),

    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),

    lastPolledAt: timestamp("last_polled_at"),

    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),

    scope: jsonb("scope_json").$type<Scope>(),

    scopeKey: text("scope_key"),

    status: cliAuthSessionStatus("status").default("pending").notNull(),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),

    userCodeHash: text("user_code_hash").notNull(),
  },
  (table) => [
    index("cli_auth_session_project_id_status_idx").on(
      table.projectId,
      table.status
    ),
    index("cli_auth_session_project_scope_key_idx").on(
      table.projectId,
      table.scopeKey
    ),
    index("cli_auth_session_expires_at_idx").on(table.expiresAt),

    uniqueIndex("cli_auth_session_device_code_hash_unique").on(
      table.deviceCodeHash
    ),
    uniqueIndex("cli_auth_session_user_code_hash_unique").on(
      table.userCodeHash
    ),
  ]
);

const CliTokenSchema = createSelectSchema(cliToken, {
  scope: scopeSchema,
  scopeKey: scopeKeySchema,
});

export type CliToken = z.output<typeof CliTokenSchema>;

const CliAuthSessionSchema = createSelectSchema(cliAuthSession, {
  scope: scopeSchema.nullable(),
  scopeKey: scopeKeySchema.nullable(),
});

export type CliAuthSession = z.output<typeof CliAuthSessionSchema>;

export { CliTokenSchema as CliToken };

export { CliAuthSessionSchema as CliAuthSession };
