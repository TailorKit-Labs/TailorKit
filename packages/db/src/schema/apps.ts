import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

import { createShortId } from "#short-id";

import { project } from "./project";
import { scopeKeySchema, scopeSchema } from "./scope";
import type { Scope } from "./scope";

export const app = pgTable(
  "app",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdByAgent: boolean("created_by_agent").notNull().default(false),
    currentDeploymentId: uuid("current_deployment_id").references(
      // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
      (): AnyPgColumn => appDeployment.id,
      { onDelete: "restrict" }
    ),
    description: text("description"),
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    scope: jsonb("scope_json").$type<Scope>().notNull(),
    scopeKey: text("scope_key").notNull(),
    shortId: varchar("short_id", { length: 12 })
      .notNull()
      .$defaultFn(createShortId),
    slug: varchar("slug", { length: 32 })
      .notNull()
      .default(
        sql`('app-' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 28))`
      ),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check("app_short_id_format", sql`${table.shortId} ~ '^[a-z0-9]{12}$'`),
    check("app_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    uniqueIndex("app_project_id_slug_unique").on(table.projectId, table.slug),
    index("app_project_scope_key_idx").on(table.projectId, table.scopeKey),
    uniqueIndex("app_project_id_short_id_unique").on(
      table.projectId,
      table.shortId
    ),
  ]
);

export const appSlugSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .describe(
    "Immutable app username, unique within the project. Lowercase letters, digits, and single hyphens."
  );

const AppSchema = createSelectSchema(app, {
  description: z.string().max(255).nullable(),
  name: z.string().max(127),
  scope: scopeSchema,
  scopeKey: scopeKeySchema,
  shortId: z.string().regex(/^[a-z0-9]{12}$/u),
  slug: appSlugSchema,
});

export type App = z.output<typeof AppSchema>;

/** Independent conversations for an app; their snapshots retain Pi journals. */
export const appAgentThread = pgTable(
  "app_agent_thread",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    invalidatedAt: timestamp("invalidated_at"),
    resumeState: text("resume_state"),
    sandboxName: text("sandbox_name"),
  },
  (table) => [index("app_agent_thread_app_id_idx").on(table.appId)]
);

/** One writer per app workspace, independently of the selected conversation. */
export const appAgentLease = pgTable("app_agent_lease", {
  activeRunId: text("active_run_id"),
  activeThreadId: uuid("active_thread_id").references(() => appAgentThread.id, {
    onDelete: "set null",
  }),
  appId: uuid("app_id")
    .primaryKey()
    .references(() => app.id, { onDelete: "cascade" }),
  cleanupSandboxName: text("cleanup_sandbox_name"),
  leaseExpiresAt: timestamp("lease_expires_at"),
});

export const appDeploymentStatus = pgEnum("app_deployment_status", [
  "uploading",
  "deploying",
  "verifying",
  "published",
]);

export const appDeployment = pgTable(
  "app_deployment",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    clientEntryFileId: uuid("client_entry_file_id").references(
      // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
      (): AnyPgColumn => appDeploymentFile.id,
      { onDelete: "restrict" }
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    hooks: jsonb("hooks").$type<string[]>().notNull().default([]),
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    logoDarkFileId: uuid("logo_dark_file_id").references(
      // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
      (): AnyPgColumn => appDeploymentFile.id,
      {
        onDelete: "restrict",
      }
    ),
    logoDarkPath: text("logo_dark_path"),
    logoLightFileId: uuid("logo_light_file_id").references(
      // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
      (): AnyPgColumn => appDeploymentFile.id,
      { onDelete: "restrict" }
    ),
    logoLightPath: text("logo_light_path"),
    shortId: varchar("short_id", { length: 12 })
      .notNull()
      .$defaultFn(createShortId),
    status: appDeploymentStatus("status").default("deploying").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    views: jsonb("views")
      .$type<
        { slot: string; path: string; instances?: true; disabled?: true }[]
      >()
      .notNull()
      .default([]),
  },
  (table) => [
    check(
      "app_deployment_short_id_format",
      sql`${table.shortId} ~ '^[a-z0-9]{12}$'`
    ),
    uniqueIndex("app_deployment_app_id_short_id_unique").on(
      table.appId,
      table.shortId
    ),
  ]
);

export const deploymentHooksSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_]{0,63})*$/u)
      .refine(
        (name) =>
          !name
            .split(".")
            .some((part) =>
              ["constructor", "prototype", "__proto__"].includes(part)
            ),
        "Reserved hook name"
      )
  )
  .max(1000)
  .refine(
    (names) => new Set(names).size === names.length,
    "Duplicate hook names"
  );

const AppDeploymentSchema = createSelectSchema(appDeployment, {
  hooks: deploymentHooksSchema,
  shortId: z.string().regex(/^[a-z0-9]{12}$/u),
  views: z
    .array(
      z.object({
        disabled: z.literal(true).optional(),
        instances: z.literal(true).optional(),
        path: z.string().startsWith("/").max(1024),
        slot: z.string().min(1).max(255),
      })
    )
    .max(1000),
});

export type AppDeployment = z.output<typeof AppDeploymentSchema>;

export const appDeploymentFileContentType = pgEnum(
  "app_deployment_file_content_type",
  ["application/javascript", "image/svg+xml", "image/png", "image/webp"]
);

export const appDeploymentFileEncoding = pgEnum(
  "app_deployment_file_encoding",
  ["utf-8", "gzip"]
);

export const appDeploymentFileStatus = pgEnum("app_deployment_file_status", [
  "uploading",
  "verifying",
  "verified",
  "failed",
]);

export const appDeploymentFile = pgTable(
  "app_deployment_file",
  {
    appDeploymentId: uuid("app_deployment_id")
      .notNull()
      .references(() => appDeployment.id, { onDelete: "cascade" }),
    checksum: varchar("checksum", { length: 64 }),
    contentLength: integer("content_length").notNull(),
    contentType: appDeploymentFileContentType("content_type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    encoding: appDeploymentFileEncoding("encoding"),
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    objectKey: text("object_key").notNull(),
    status: appDeploymentFileStatus("status").default("uploading").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_deployment_file_app_deployment_id_object_key_unique").on(
      table.appDeploymentId,
      table.objectKey
    ),
  ]
);

const AppDeploymentFileSchema = createSelectSchema(appDeploymentFile, {
  objectKey: z
    .string()
    .max(512)
    .regex(
      /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/u,
      "Must be a valid object key like assets/client.js"
    ),
});

export type AppDeploymentFile = z.output<typeof AppDeploymentFileSchema>;

export { AppSchema as App };

export { AppDeploymentSchema as AppDeployment };

export { AppDeploymentFileSchema as AppDeploymentFile };
