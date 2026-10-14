import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  avatar: text("avatar").notNull(),
  email: text("email").notNull().unique(),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
});

export const teamMembers = sqliteTable(
  "team_members",
  {
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })]
);

export const issues = sqliteTable("issues", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  description: text("description").notNull().default(""),
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  status: text("status", { enum: ["Backlog", "In Progress", "Done"] })
    .notNull()
    .default("Backlog"),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
});

export const todos = sqliteTable("playground_todos", {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
});
