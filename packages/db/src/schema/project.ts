import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createShortId } from "#short-id";

import { organization } from "./auth";

export const project = pgTable(
  "project",
  {
    createdAt: timestamp("created_at").defaultNow().notNull(),
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    shortId: varchar("short_id", { length: 12 })
      .$defaultFn(createShortId)
      .notNull()
      .unique(),
    slug: text("slug").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check("project_short_id_format", sql`${table.shortId} ~ '^[a-z0-9]{12}$'`),
    uniqueIndex("project_organizationId_slug_unique").on(
      table.organizationId,
      table.slug
    ),
  ]
);

export type Project = typeof project.$inferSelect;
