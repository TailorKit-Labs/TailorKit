/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import { DatabaseSync } from "node:sqlite";

import {
  table,
  text,
  boolean,
  eq,
  defineDatabase,
  defineRelations,
} from "@tailorkit/app-db";
import {
  defineServer,
  query,
  mutation,
  fn,
  AppError,
} from "@tailorkit/app/server";
import { asyncFixture } from "@tailorkit/config/testing";
import { sql } from "drizzle-orm";
import { sqliteView } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { databaseScope } from "./database/driver";
import type { Persistence } from "./database/driver";
import { createExecution } from "./execution";

const todos = table("todos", {
  done: boolean().notNull().default(false),
  id: text().primaryKey(),
  title: text().notNull(),
});
const users = table("users", {
  id: text().primaryKey(),
  title: text().notNull(),
});
const viewColumns = () => ({
  done: boolean().notNull(),
  id: text().primaryKey(),
  title: text().notNull(),
});
const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "installation",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};
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
  // Disposable schema setup, not app migration distribution.
  sqlite.exec(
    "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0); CREATE TABLE users (id TEXT PRIMARY KEY, title TEXT NOT NULL)"
  );
  const persistence: Persistence = {
    execute(sqlValue, params) {
      const statement = sqlite.prepare(sqlValue);
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
        changes: Number(sqlite.prepare("SELECT changes() AS n").get()?.n),
        columns: statement.columns().map((column) => column.name),
        rows,
      };
    },
    transaction(run) {
      sqlite.exec("BEGIN");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const app = defineServer({
    add: mutation({
      args: z.object({ id: z.string(), title: z.string() }),
      handler: ({ db, args }) =>
        db.insert(todos).values(args).returning().all(),
    }),
    fail: mutation({
      args: z.object({}),
      handler: ({ db }) => {
        db.insert(todos).values({ id: "fail", title: "rollback" }).run();
        throw new Error("failed");
      },
    }),
    failedRead: query({
      args: z.object({}),
      handler: ({ db }) => {
        db.select().from(todos).all();
        throw new AppError("FORBIDDEN", "Read denied");
      },
    }),
    invalidResult: fn.mutation
      .output(z.object({ ok: z.literal(true) }))
      .handler(({ input, db }) => {
        expect(input).toBeUndefined();
        db.insert(todos).values({ id: "invalid", title: "rollback" }).run();
        // SAFETY: This negative test deliberately returns data outside its declared result schema to verify rejection.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
        return { ok: false } as never;
      }),
    joined: query({
      args: z.object({}),
      handler: ({ db }) =>
        db.select().from(todos).leftJoin(users, eq(users.id, todos.id)).all(),
    }),
    list: query({
      args: z.object({}),
      handler: ({ db }) => db.select().from(todos).all(),
    }),
    noop: mutation({
      args: z.object({}),
      handler: ({ db }) =>
        db.delete(todos).where(eq(todos.id, "missing")).run(),
    }),
    optionalArgs: mutation({
      args: z.unknown().optional(),
      handler: ({ args }) => args ?? null,
    }),
    oversized: mutation({
      args: z.object({}),
      handler: ({ db }) => {
        db.insert(todos).values({ id: "large", title: "rollback" }).run();
        return "🧵".repeat(300_000);
      },
    }),
    unserializable: fn.mutation
      .input(z.enum(["bigint", "cycle"]))
      .handler(({ input, db }) => {
        db.insert(todos).values({ id: input, title: "rollback" }).run();
        if (input === "bigint") {
          return 1n;
        }
        interface CyclicResult {
          self?: CyclicResult;
        }
        const value: CyclicResult = {};
        value.self = value;
        return value;
      }),
  });
  return { execution: createExecution(app, persistence), persistence, sqlite };
};
it("distinguishes omitted and null mutation arguments when checking a replay receipt", () => {
  const { execution } = fixture();
  const requestId = crypto.randomUUID();
  expect(
    execution.mutate({ name: "optionalArgs", requestId }, identity).value
  ).toBeNull();
  expect(() =>
    execution.mutate({ args: null, name: "optionalArgs", requestId }, identity)
  ).toThrow("Mutation ID was already used for different arguments or identity");
});
it("executes typed Drizzle operations and tracks read tables including empty joins", () => {
  const { execution } = fixture();
  expect(execution.query({ args: {}, name: "list" }, identity)).toEqual({
    tables: ["todos"],
    value: [],
  });
  expect(
    execution.query({ args: {}, name: "joined" }, identity).tables.toSorted()
  ).toEqual(["todos", "users"]);
  const accepted = execution.mutate(
    {
      args: { id: "1", title: "hello" },
      name: "add",
      requestId: crypto.randomUUID(),
    },
    identity
  );
  expect(accepted).toMatchObject({
    committed: true,
    tables: ["todos"],
    value: [{ done: false, id: "1", title: "hello" }],
  });
  expect(execution.query({ args: {}, name: "list" }, identity).value).toEqual(
    accepted.value
  );
});
it.each([
  {
    name: "query builder",
    view: sqliteView("todo_view").as((qb) => qb.select().from(todos)),
  },
  {
    name: "raw SQL",
    view: sqliteView("todo_view", viewColumns()).as(sql`SELECT * FROM todos`),
  },
  { name: "existing", view: sqliteView("todo_view", viewColumns()).existing() },
])(
  "tracks any table write for $name relational views without their base table",
  ({ view }) => {
    const { persistence, sqlite, execution: mutations } = fixture();
    sqlite.exec(
      "CREATE VIEW todo_view AS SELECT * FROM todos; INSERT INTO users VALUES ('1', 'Author')"
    );
    const directDatabase = defineDatabase({
      relations: defineRelations({ view }),
    });
    const nestedDatabase = defineDatabase({
      relations: defineRelations({ users, view }, (r) => ({
        users: { todos: r.many.view({ from: r.users.id, to: r.view.id }) },
      })),
    });
    const execution = createExecution(
      defineServer({
        direct: fn.query
          .database(directDatabase)
          .handler(({ db }) => db.query.view.findMany().sync()),
        nested: fn.query
          .database(nestedDatabase)
          .handler(({ db }) =>
            db.query.users.findMany({ with: { todos: true } }).sync()
          ),
      }),
      persistence
    );
    expect(execution.query({ name: "direct" }, identity)).toEqual({
      tables: ["*"],
      value: [],
    });
    expect(execution.query({ name: "nested" }, identity)).toEqual({
      tables: ["users", "*"],
      value: [{ id: "1", title: "Author", todos: [] }],
    });
    const inserted = mutations.mutate(
      {
        args: { id: "1", title: "hello" },
        name: "add",
        requestId: crypto.randomUUID(),
      },
      identity
    );
    expect(inserted.tables).toEqual(["todos"]);
    expect(execution.query({ name: "direct" }, identity).value).toEqual(
      inserted.value
    );
    expect(execution.query({ name: "nested" }, identity).value).toEqual([
      { id: "1", title: "Author", todos: inserted.value },
    ]);
  }
);
it("rolls back all writes and receipts when handlers or result validation fail", () => {
  const { execution, sqlite } = fixture();
  for (const name of ["fail", "invalidResult"]) {
    expect(() =>
      execution.mutate(
        {
          args: name === "fail" ? {} : undefined,
          name,
          requestId: crypto.randomUUID(),
        },
        identity
      )
    ).toThrow();
  }
  expect(execution.query({ args: {}, name: "list" }, identity).value).toEqual(
    []
  );
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()
  ).toMatchObject({
    n: 0,
  });
});
it("deduplicates accepted writes and rejects reused IDs with different identity or arguments", () => {
  const { execution } = fixture();
  const input = {
    args: { id: "1", title: "hello" },
    name: "add",
    requestId: crypto.randomUUID(),
  };
  execution.mutate(input, identity);
  expect(execution.mutate(input, identity).committed).toBe(false);
  expect(() =>
    execution.mutate(
      { ...input, args: { ...input.args, title: "other" } },
      identity
    )
  ).toThrow("already used");
  expect(() =>
    execution.mutate(input, { ...identity, subjectId: "other" })
  ).toThrow("already used");
  expect(
    execution.query({ args: {}, name: "list" }, identity).value
  ).toHaveLength(1);
});
it("validates input, function kind and expiry before execution", () => {
  const { execution } = fixture();
  expect(() => execution.query({ args: {}, name: "add" }, identity)).toThrow(
    "not found"
  );
  expect(() =>
    execution.query({ args: {}, name: "list" }, { ...identity, expiresAt: 1 })
  ).toThrow("expired");
  expect(() =>
    execution.mutate(
      { args: {}, name: "add", requestId: crypto.randomUUID() },
      identity
    )
  ).toThrow("arguments");
});
it("does not invalidate a table for a mutation that changes no rows", () => {
  const { execution } = fixture();
  expect(
    execution.mutate(
      { args: {}, name: "noop", requestId: crypto.randomUUID() },
      identity
    ).tables
  ).toEqual([]);
});
it("rejects async handlers and revokes their database scope before continuations run", async () => {
  const { persistence, sqlite } = fixture();
  let lateError: unknown;
  const bad = createExecution(
    defineServer({
      bad: {
        args: z.object({}),
        handler: async (ctx: {
          db: Parameters<Parameters<typeof mutation>[0]["handler"]>[0]["db"];
        }) => {
          ctx.db.insert(todos).values({ id: "early", title: "rollback" }).run();
          await Promise.resolve();
          try {
            ctx.db.insert(todos).values({ id: "late", title: "outside" }).run();
          } catch (error) {
            lateError = error;
          }
        },
        kind: "mutation",
      },
    }),
    persistence
  );
  expect(() =>
    bad.mutate(
      { args: {}, name: "bad", requestId: crypto.randomUUID() },
      identity
    )
  ).toThrow("synchronous");
  await Promise.resolve();
  expect(lateError).toBeInstanceOf(Error);
  expect(sqlite.prepare("SELECT count(*) AS n FROM todos").get()).toMatchObject(
    { n: 0 }
  );
});

it("allows large results without a custom transport limit", () => {
  const { execution, sqlite } = fixture();
  const result = execution.mutate(
    { args: {}, name: "oversized", requestId: crypto.randomUUID() },
    identity
  );
  expect(result.committed).toBe(true);
  expect(
    sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()
  ).toMatchObject({
    n: 1,
  });
});

it("returns structured results and per-call table metadata on success and errors", () => {
  const { execution } = fixture();
  const read = Effect.runSync(
    execution.call("query", { args: {}, name: "list" }, identity)
  );
  expect(read).toMatchObject({
    committed: false,
    result: { ok: true },
    tables: ["todos"],
  });
  expect(read.result).toEqual({ ok: true, value: [] });
  const failedRead = Effect.runSync(
    execution.call("query", { args: {}, name: "failedRead" }, identity)
  );
  expect(failedRead).toMatchObject({
    committed: false,
    result: { error: { code: "FORBIDDEN" }, ok: false },
    tables: ["todos"],
  });
  expect(failedRead.result.ok ? undefined : failedRead.result.error).toEqual({
    code: "FORBIDDEN",
    message: "Read denied",
  });
  const failedWrite = Effect.runSync(
    execution.call(
      "mutation",
      { args: {}, name: "fail", requestId: crypto.randomUUID() },
      identity
    )
  );
  expect(failedWrite).toMatchObject({
    committed: false,
    result: { error: { code: "INTERNAL_SERVER_ERROR" }, ok: false },
    tables: ["todos"],
  });
  expect(execution.query({ args: {}, name: "list" }, identity).value).toEqual(
    []
  );
  expect(
    Effect.runSync(execution.call("query", { name: "missing" }, identity))
      .tables
  ).toEqual([]);
  expect(
    Effect.runSync(
      execution.call("mutation", { args: {}, name: "add" }, identity)
    ).result
  ).toMatchObject({
    error: { code: "BAD_REQUEST" },
    ok: false,
  });
});

it.each(["bigint", "cycle"])(
  "rolls back writes and receipts before returning an unserializable %s",
  (args) => {
    const { execution, sqlite } = fixture();
    const outcome = Effect.runSync(
      execution.call(
        "mutation",
        { args, name: "unserializable", requestId: crypto.randomUUID() },
        identity
      )
    );
    expect(outcome).toMatchObject({
      committed: false,
      result: { error: { code: "INTERNAL_SERVER_ERROR" }, ok: false },
      tables: ["todos"],
    });
    expect(execution.query({ args: {}, name: "list" }, identity).value).toEqual(
      []
    );
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()
    ).toMatchObject({
      n: 0,
    });
  }
);

it("runs action database calls locally and notifies only committed writes before the action finishes", async () => {
  const { persistence, sqlite } = fixture();
  const records = {
    add: fn.mutation
      .input(z.object({ id: z.string(), title: z.string() }))
      .handler(({ input, db }) =>
        db.insert(todos).values(input).returning().all()
      ),
    fail: fn.mutation.handler(({ db }) => {
      db.insert(todos).values({ id: "rolled-back", title: "discard" }).run();
      throw new AppError("CONFLICT", "Rollback");
    }),
    list: fn.query.handler(({ db }) => db.select().from(todos).all()),
  };
  let release!: () => void;
  const external = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();
    try {
      release = resolve;
    } catch (error) {
      rejectPending(error);
    }
    await pendingPromise;
  })();
  let ready!: () => void;
  const committed = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();
    try {
      ready = resolve;
    } catch (error) {
      rejectPending(error);
    }
    await pendingPromise;
  })();
  const requestId = crypto.randomUUID();
  const app = defineServer({
    records,
    run: fn.action
      .functions({ records })
      .handler(async ({ queries, mutations }) => {
        const input = { id: "committed", title: "local" };
        await mutations.records.add(input, { requestId });
        await mutations.records.add(input, { requestId });
        await expect(mutations.records.fail()).rejects.toMatchObject({
          code: "CONFLICT",
        });
        await Array.fromAsync(
          Array.from({ length: 100 }, (_, i) => i),
          async (_i) => {
            await queries.records.list();
          }
        );
        await external;
        return await queries.records.list();
      }),
  });
  const execution = createExecution(app, persistence);
  const notify = vi.fn(
    asyncFixture((tables: string[]) => {
      expect(tables).toEqual(["todos"]);
      expect(
        sqlite.prepare("SELECT count(*) AS n FROM tailorkit_receipts").get()
      ).toMatchObject({
        n: 1,
      });
      ready();
    })
  );
  let finished = false;
  const running = Effect.runPromise(
    execution.action(
      { name: "run" },
      identity,
      { committed: notify },
      new AbortController().signal
    )
  ).then((result) => {
    finished = true;
    return result;
  });
  await committed;
  expect(finished).toBe(false);
  expect(
    execution.query({ name: "records.list" }, identity).value
  ).toMatchObject([{ id: "committed" }]);
  release();
  expect(await running).toMatchObject({
    committed: false,
    result: { ok: true, value: [{ id: "committed" }] },
    tables: [],
  });
  expect(notify).toHaveBeenCalledOnce();
});

it("runs nested relational queries and preserves scope, permissions and invalidation", () => {
  const { sqlite, persistence } = fixture();
  const relations = defineRelations({ todos, users }, (r) => ({
    todos: { user: r.one.users({ from: r.todos.id, to: r.users.id }) },
    users: { todos: r.many.todos({ from: r.users.id, to: r.todos.id }) },
  }));
  const database = defineDatabase({ relations });
  const app = defineServer({
    absent: fn.query
      .database(database)
      .handler(
        ({ db }) =>
          db.query.todos.findFirst({ where: { id: "missing" } }).sync() ?? null
      ),
    first: query({
      args: z.undefined(),
      database,
      handler: ({ db }) =>
        db.query.todos
          .findFirst({ where: { id: "one" }, with: { user: true } })
          .sync() ?? null,
    }),
    insert: fn.mutation
      .database(database)
      .input(z.string())
      .handler(({ db, input }) => {
        db.insert(todos)
          .values({ done: true, id: input, title: "Nested todo" })
          .run();
        return db.query.todos
          .findFirst({ where: { id: input }, with: { user: true } })
          .sync();
      }),
    list: fn.query
      .database(database)
      .handler(({ db }) =>
        db.query.users
          .findMany({ orderBy: { id: "asc" }, with: { todos: true } })
          .sync()
      ),
    writeInQuery: fn.query.database(database).handler(({ db }) => {
      // @ts-expect-error Verify runtime enforcement even if a caller bypasses the type restriction.
      db.insert(todos).values({ id: "forbidden", title: "No" }).run();
      return null;
    }),
  });
  const execution = createExecution(app, persistence);
  expect(execution.query({ name: "list" }, identity)).toEqual({
    tables: ["todos", "users"],
    value: [],
  });
  sqlite.exec("INSERT INTO users VALUES ('one', 'Author')");
  const inserted = execution.mutate(
    { args: "one", name: "insert", requestId: crypto.randomUUID() },
    identity
  );
  const todo = {
    done: true,
    id: "one",
    title: "Nested todo",
    user: { id: "one", title: "Author" },
  };
  expect(inserted.value).toEqual(todo);
  expect(inserted.tables).toEqual(["todos"]);
  expect(execution.query({ name: "first" }, identity).value).toEqual(todo);
  expect(execution.query({ name: "list" }, identity).value).toEqual([
    {
      id: "one",
      title: "Author",
      todos: [{ done: true, id: "one", title: "Nested todo" }],
    },
  ]);
  expect(execution.query({ name: "absent" }, identity).value).toBeNull();
  expect(() => execution.query({ name: "writeInQuery" }, identity)).toThrow(
    "Queries cannot write"
  );
  const scope = databaseScope(persistence, false, relations);
  const usersQuery = scope.db.query.users;
  if (!(usersQuery !== undefined && usersQuery !== null)) {
    throw new Error("Missing users query");
  }
  const prepared = usersQuery.findMany().prepare();
  scope.close();
  expect(() => prepared.all()).toThrow("Database scope has ended");
});
