import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { defineServer, query } from "@patchsmith/app/server";
import { afterEach, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createExecution } from "../execution";
import type { Persistence } from "./driver";
import { migrateDatabase } from "./migrations";
import type { AppMigration } from "./migrations";

const migration = (id: string, file: string): AppMigration => {
  const sql = readFileSync(new URL(file, import.meta.url), "utf-8");
  return {
    hash: createHash("sha256").update(sql).digest("hex"),
    id,
    statements: sql.split("--> statement-breakpoint"),
  };
};
const initial = migration(
  "20261001000000_init",
  "../../tests/fixtures/todos-init.sql"
);
const priority = migration(
  "20261001000001_priority",
  "../../tests/fixtures/todos-priority.sql"
);
const required = migration(
  "20261001000002_required",
  "../../tests/fixtures/todos-required.sql"
);
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const db of connections) {
    db.close();
  }
  connections.length = 0;
});
const fixture = () => {
  const sqlite = new DatabaseSync(":memory:");
  connections.push(sqlite);
  const persistence: Persistence = {
    execute(sql, params) {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      let rows: unknown[][] = [];
      if (statement.columns().length) {
        // SAFETY: setReturnArrays(true) forces positional rows; Node's declarations still describe records.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- Node's SQLite declaration does not reflect setReturnArrays. This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
        rows = statement.all(...(params as never[])) as unknown as unknown[][];
      } else {
        // SAFETY: This test supplies the SQLite-compatible parameters used by its fixture queries.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
        statement.run(...(params as never[]));
      }
      return {
        changes: 0,
        columns: statement.columns().map((column) => column.name),
        rows,
      };
    },
    transaction(run) {
      sqlite.exec("BEGIN");
      try {
        const value = run();
        sqlite.exec("COMMIT");
        return value;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { persistence, sqlite };
};

it("initializes a fresh database and applies pending migrations without replaying or losing data", () => {
  const { sqlite, persistence } = fixture();
  migrateDatabase(persistence, [initial]);
  sqlite.exec("INSERT INTO todos (id, text) VALUES ('one', 'Persisted')");
  migrateDatabase(persistence, [initial, priority]);
  migrateDatabase(persistence, [initial, priority]);
  expect(
    sqlite.prepare("SELECT text, priority FROM todos").get()
  ).toMatchObject({
    priority: 0,
    text: "Persisted",
  });
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM tailorkit_migrations").get()
  ).toMatchObject({
    n: 2,
  });
  const other = fixture();
  migrateDatabase(other.persistence, [initial, priority]);
  expect(
    other.sqlite.prepare("SELECT COUNT(*) AS n FROM todos").get()
  ).toMatchObject({ n: 0 });
});

it("rolls back the entire pending upgrade and journal if a migration fails, and can retry", () => {
  const { sqlite, persistence } = fixture();
  migrateDatabase(persistence, [initial]);
  sqlite.exec("INSERT INTO todos (id, text) VALUES ('one', 'Persisted')");
  expect(() => {
    migrateDatabase(persistence, [initial, priority, required]);
  }).toThrow();
  expect(
    sqlite
      .prepare("PRAGMA table_info(todos)")
      .all()
      .map((row) => row.name)
  ).toEqual(["id", "text", "done"]);
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM tailorkit_migrations").get()
  ).toMatchObject({
    n: 1,
  });
  migrateDatabase(persistence, [initial, priority]);
  expect(
    sqlite.prepare("SELECT text, priority FROM todos").get()
  ).toMatchObject({
    priority: 0,
    text: "Persisted",
  });
});

it("allows older migration prefixes but rejects changed, inserted or reordered history", () => {
  const { sqlite, persistence } = fixture();
  migrateDatabase(persistence, [initial, priority]);
  expect(() => {
    migrateDatabase(persistence, []);
  }).not.toThrow();
  expect(() => {
    migrateDatabase(persistence, [initial]);
  }).not.toThrow();
  expect(
    sqlite
      .prepare("PRAGMA table_info(todos)")
      .all()
      .map((row) => row.name)
  ).toContain("priority");
  for (const history of [
    [{ ...initial, hash: "a".repeat(64) }],
    [{ ...initial, hash: "a".repeat(64) }, priority],
    [{ ...initial, id: "20260901000000_inserted" }, initial, priority],
  ]) {
    expect(() => {
      migrateDatabase(persistence, history);
    }).toThrow("must not be changed");
  }
  expect(() => {
    migrateDatabase(persistence, [priority, initial]);
  }).toThrow("Invalid app migration history");
  expect(() => {
    migrateDatabase(persistence, [initial, initial]);
  }).toThrow("Invalid app migration history");
  expect(
    sqlite.prepare("SELECT COUNT(*) AS n FROM tailorkit_migrations").get()
  ).toMatchObject({
    n: 2,
  });
});

it("does not expose database handlers when initialization fails", () => {
  const { sqlite, persistence } = fixture();
  migrateDatabase(persistence, [initial]);
  sqlite.exec("INSERT INTO todos (id, text) VALUES ('one', 'Persisted')");
  let calls = 0;
  const app = defineServer({
    probe: query({ args: z.object({}), handler: () => (calls += 1) }),
  });
  expect(() =>
    createExecution(app, persistence, [initial, required])
  ).toThrow();
  expect(calls).toBe(0);
});
