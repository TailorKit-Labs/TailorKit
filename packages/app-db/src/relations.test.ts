import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";
import { describe, expect, it } from "vite-plus/test";

import { defineDatabase, defineRelations, table, text, boolean } from "#index";

const users = table("users", { id: text().primaryKey() });
const posts = table("posts", {
  id: text().primaryKey(),
  published: boolean().notNull().default(false),
  userId: text(),
});
const schema = { posts, users };

describe("Patchsmith relations", () => {
  it("includes every table when navigation is omitted", () => {
    const relations = defineRelations(schema);
    expect(Object.keys(relations).toSorted()).toEqual(["posts", "users"]);
    expect(relations.posts.table).toBe(posts);
    expect(relations.users.relations).toEqual({});
    expect(defineRelations({})).toEqual({});
  });

  it("preserves nested reads, optional relations, and boolean columns", () => {
    const relations = defineRelations(schema, (r) => ({
      posts: {
        user: r.one.users({ from: r.posts.userId, to: r.users.id }),
      },
      users: {
        posts: r.many.posts({ from: r.users.id, to: r.posts.userId }),
      },
    }));
    const database = defineDatabase({ relations });
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE posts (id TEXT PRIMARY KEY, userId TEXT, published INTEGER NOT NULL DEFAULT 0);
      `);
      const db = drizzle({ client: sqlite, relations: database.relations });
      db.insert(users).values({ id: "u1" }).run();
      db.insert(posts)
        .values([{ id: "p1", published: true, userId: "u1" }, { id: "p2" }])
        .run();

      const rows = db.query.users.findMany({ with: { posts: true } }).sync();
      rows satisfies {
        id: string;
        posts: { id: string; userId: string | null; published: boolean }[];
      }[];
      expect(rows).toEqual([
        { id: "u1", posts: [{ id: "p1", published: true, userId: "u1" }] },
      ]);
      expect(
        db.query.posts
          .findFirst({ where: { id: "p2" }, with: { user: true } })
          .sync()
      ).toEqual({ id: "p2", published: false, user: null, userId: null });
      expect(Object.isFrozen(database)).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
