import type { Invocation } from "@tailorkit/app/protocol";
import { action, defineServer, query, mutation } from "@tailorkit/app/server";
import type {
  ActionContext,
  AppDefinition,
  Identity,
} from "@tailorkit/app/server";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createActionExecution } from "./actions";
import type { ActionCalls } from "./actions";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const actionRunner = (app: AppDefinition, calls: ActionCalls) => {
  const run = createActionExecution(app);
  // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
  return (input: Invocation, identity: Identity, signal?: AbortSignal) =>
    run(input, identity, calls, signal);
};

const identity = {
  appId: "app",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
  installationId: "install",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};
const functions = {
  read: query({ args: z.object({}), handler: () => 4 }),
  write: mutation({
    args: z.object({ value: z.number() }),
    handler: ({ args }) => args.value,
  }),
};

it("awaits actions and exposes scoped calls instead of a database handle", async () => {
  const queryCall = vi.fn().mockResolvedValue(4);
  const mutateCall = vi.fn().mockResolvedValue(6);
  const app = defineServer({
    ...functions,
    plus: action({
      args: z.object({ delta: z.number() }),
      functions,
      async handler(context) {
        expect("db" in context).toBe(false);
        expect("runQuery" in context).toBe(false);
        expect(Object.keys(context.queries)).toEqual(["read"]);
        expect(Object.keys(context.mutations)).toEqual(["write"]);
        expect(Object.isFrozen(context.mutations)).toBe(true);
        expect(context.identity).toEqual(identity);
        const prior = await context.queries.read({});
        return await context.mutations.write({
          value: prior + context.args.delta,
        });
      },
      result: z.number(),
    }),
  });
  const run = actionRunner(app, { mutate: mutateCall, query: queryCall });
  expect(await run({ args: { delta: 2 }, name: "plus" }, identity)).toBe(6);
  expect(queryCall).toHaveBeenCalledWith({ args: {}, name: "read" });
  expect(mutateCall).toHaveBeenCalledWith({
    args: { value: 6 },
    name: "write",
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matchers intentionally return any; this value is used only to describe an assertion, not as application data.
    requestId: expect.any(String),
  });
});

it("validates kind, arguments, expiry and output", async () => {
  const calls = { mutate: vi.fn(), query: vi.fn() };
  // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.
  const app = defineServer({
    ...functions,
    invalid: action({
      args: z.object({ value: z.string() }),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
      handler: () => 1 as never,
      result: z.string(),
    }),
    read: query({ args: z.object({}), handler: () => 1 }),
  });
  const run = actionRunner(app, calls);
  await expect(run({ args: {}, name: "read" }, identity)).rejects.toMatchObject(
    {
      code: "NOT_FOUND",
    }
  );
  await expect(
    run({ args: {}, name: "invalid" }, identity)
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    run(
      { args: { value: "x" }, name: "invalid" },
      { ...identity, expiresAt: 0 }
    )
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    run({ args: { value: "x" }, name: "invalid" }, identity)
  ).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  expect(calls.query).not.toHaveBeenCalled();
});

it("does not retry actions or roll back earlier independent mutations after failure", async () => {
  const mutate = vi.fn().mockResolvedValue(1);
  const sideEffect = vi.fn();
  const app = defineServer({
    ...functions,
    fail: action({
      args: z.object({}),
      functions,
      async handler(ctx) {
        sideEffect();
        await ctx.mutations.write(
          { value: 1 },
          { requestId: "00000000-0000-4000-8000-000000000001" }
        );
        throw new Error("external failure");
      },
    }),
  });
  await expect(
    actionRunner(app, { mutate, query: vi.fn() })(
      { args: {}, name: "fail" },
      identity
    )
  ).rejects.toThrow("external failure");
  expect(sideEffect).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({
    args: { value: 1 },
    name: "write",
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  expect(mutate).toHaveBeenCalledTimes(1);
});

it("revokes callbacks after completion and cancellation", async () => {
  let context!: ActionContext<typeof functions>;
  const mutate = vi.fn();
  const app = defineServer({
    ...functions,
    capture: action({
      args: z.object({}),
      functions,
      handler: (ctx) => {
        context = ctx;
        return null;
      },
    }),
  });
  await actionRunner(app, { mutate, query: vi.fn() })(
    { args: {}, name: "capture" },
    identity
  );
  expect(() => {
    void context.mutations.write({ value: 1 });
  }).toThrow("Action has ended");
  const controller = new AbortController();
  controller.abort();
  await expect(
    actionRunner(app, { mutate, query: vi.fn() })(
      { args: {}, name: "capture" },
      identity,
      controller.signal
    )
  ).rejects.toThrow("Action has ended");
  expect(mutate).not.toHaveBeenCalled();
});

it("revokes a running action's callbacks before its asynchronous work finishes", async () => {
  let context!: ActionContext<typeof functions>;
  const { promise: external, resolve: finish } =
    Promise.withResolvers<ReturnType<() => void>>();
  const mutate = vi.fn();
  const app = defineServer({
    ...functions,
    wait: action({
      args: z.object({}),
      functions,
      async handler(ctx) {
        context = ctx;
        await external;
        return null;
      },
    }),
  });
  const controller = new AbortController();
  const running = actionRunner(app, { mutate, query: vi.fn() })(
    { args: {}, name: "wait" },
    identity,
    controller.signal
  );
  controller.abort();
  expect(() => {
    void context.mutations.write({ value: 1 });
  }).toThrow("Action has ended");
  finish();
  await expect(running).rejects.toThrow("Action has ended");
  expect(mutate).not.toHaveBeenCalled();
});

it("rejects action call collections that are not registered under the same names", () => {
  const calls = { mutate: vi.fn(), query: vi.fn() };
  const app = defineServer({
    bad: action({
      args: z.object({}),
      functions: { missing: functions.write },
      // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
      handler: (ctx) => ctx.mutations.missing({ value: 1 }),
    }),
    write: functions.write,
  });
  expect(() => createActionExecution(app)).toThrow(
    "Action function is not registered in this app"
  );
  expect(calls.mutate).not.toHaveBeenCalled();
});

it("reuses compiled nested bindings while isolating concurrent calls and retained callbacks", async () => {
  const nested = { records: { read: functions.read, write: functions.write } };
  const contexts: ActionContext<typeof nested>[] = [];
  const { promise: waiting, resolve: release } =
    Promise.withResolvers<ReturnType<() => void>>();
  const app = defineServer({
    ...nested,
    run: action({
      args: z.object({}),
      functions: nested,
      async handler(context) {
        contexts.push(context);
        expect(Object.keys(context.queries.records)).toEqual(["read"]);
        expect(Object.keys(context.mutations.records)).toEqual(["write"]);
        await waiting;
        return await context.queries.records.read({});
      },
    }),
  });
  const run = createActionExecution(app);
  const first = { mutate: vi.fn(), query: vi.fn().mockResolvedValue("first") };
  const second = {
    mutate: vi.fn(),
    query: vi.fn().mockResolvedValue("second"),
  };
  const one = run({ args: {}, name: "run" }, identity, first);
  const two = run(
    { args: {}, name: "run" },
    { ...identity, subjectId: "second" },
    second
  );
  release();
  expect(await Promise.all([one, two])).toEqual(["first", "second"]);
  expect(contexts.map((context) => context.identity.subjectId)).toEqual([
    "user",
    "second",
  ]);
  for (const calls of [first, second]) {
    expect(calls.query).toHaveBeenCalledExactlyOnceWith({
      args: {},
      name: "records.read",
    });
  }
  for (const context of contexts) {
    expect(() => {
      void context.mutations.records.write({ value: 1 });
    }).toThrow("Action has ended");
  }
});

it("runs generated instance resolvers with all registered queries and no write capabilities", async () => {
  const { withInstanceResolvers } = await import("@tailorkit/app/server");
  let retainedQuery!: () => Promise<number>;
  const app = withInstanceResolvers(defineServer({ reports: functions }), [
    {
      dataSchema: z.object({ id: z.string() }),
      path: "/reports/annual.summary",
      resolve: async (context) => {
        expect(Object.keys(context).toSorted()).toEqual([
          "context",
          "identity",
          "queries",
          "signal",
        ]);
        // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
        const queries = context.queries as ActionContext<{
          reports: typeof functions;
        }>["queries"];
        expect(Object.keys(queries.reports)).toEqual(["read"]);
        expect(context.context).toEqual({ subjectId: "user" });
        expect(context.identity).toEqual(identity);
        // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
        retainedQuery = () => queries.reports.read({});
        const count = await retainedQuery();
        return [
          {
            data: { id: "report" },
            key: "overview",
            metadata: { title: `Reports: ${count}` },
          },
        ];
      },
      slot: "page",
    },
  ]);
  const queryCall = vi.fn().mockResolvedValue(4);
  const mutateCall = vi.fn();
  const run = actionRunner(app, { mutate: mutateCall, query: queryCall });
  expect(
    await run(
      {
        args: {
          context: { subjectId: "user" },
          path: "/reports/annual.summary",
          slot: "page",
        },
        name: "_tailorkit.instances.resolve",
      },
      identity
    )
  ).toEqual([
    {
      data: { id: "report" },
      key: "overview",
      metadata: { title: "Reports: 4" },
    },
  ]);
  expect(queryCall).toHaveBeenCalledExactlyOnceWith({
    args: {},
    name: "reports.read",
  });
  expect(mutateCall).not.toHaveBeenCalled();
  expect(retainedQuery).toThrow("Action has ended");
  await expect(
    run(
      {
        args: { context: null, path: "/reports/annual.summary", slot: "page" },
        name: "_tailorkit.instances.resolve",
      },
      identity
    )
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    run(
      {
        args: { context: {}, path: "/reports/annual.summary", slot: "page" },
        name: "_tailorkit.instances.resolve",
      },
      { ...identity, expiresAt: 0 }
    )
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("validates instance payloads and stable keys before returning resolver results", async () => {
  const { withInstanceResolvers } = await import("@tailorkit/app/server");
  await Promise.all(
    [
      [{ data: { id: 123 }, key: "overview", metadata: {} }],
      [{ data: { id: "report" }, key: "", metadata: {} }],
      [
        { data: { id: "one" }, key: "overview", metadata: {} },
        { data: { id: "two" }, key: "overview", metadata: {} },
      ],
    ].map(async (result) => {
      const app = withInstanceResolvers(defineServer({}), [
        {
          dataSchema: z.object({ id: z.string() }),
          path: "/",
          resolve: () => result,
          slot: "page",
        },
      ]);

      await expect(
        actionRunner(app, { mutate: vi.fn(), query: vi.fn() })(
          {
            args: { context: {}, path: "/", slot: "page" },
            name: "_tailorkit.instances.resolve",
          },
          identity
        )
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    })
  );
});

it("reserves the internal namespace and rejects duplicate or invalid slot/path addresses", async () => {
  const { withInstanceResolvers } = await import("@tailorkit/app/server");
  const resolver = {
    dataSchema: z.object({}),
    path: "/",
    resolve: () => [],
    slot: "page",
  };
  const app = withInstanceResolvers(defineServer({}), [resolver]);
  expect(() => withInstanceResolvers(app, [])).toThrow(
    "The _tailorkit function namespace is reserved by TailorKit."
  );
  expect(() =>
    withInstanceResolvers(defineServer({}), [resolver, resolver])
  ).toThrow("Duplicate instance resolver");
  expect(() =>
    withInstanceResolvers(defineServer({}), [{ ...resolver, path: "invalid" }])
  ).toThrow();
});

it("dispatches by exact slot/path pairs and validates against the selected data schema", async () => {
  const { withInstanceResolvers } = await import("@tailorkit/app/server");
  const first = vi.fn(() => [
    { data: { id: "item" }, key: "one", metadata: {} },
  ]);
  const second = vi.fn(() => [
    { data: { count: 3 }, key: "two", metadata: {} },
  ]);
  const app = withInstanceResolvers(defineServer({}), [
    {
      dataSchema: z.object({
        id: z.string().transform((id) => id.toUpperCase()),
      }),
      path: "/reports/annual.summary",
      resolve: first,
      slot: "page.links",
    },
    {
      dataSchema: z.object({ count: z.number() }),
      path: "/reports/annual.summary",
      resolve: second,
      slot: "panel",
    },
  ]);
  const run = actionRunner(app, { mutate: vi.fn(), query: vi.fn() });
  const name = "_tailorkit.instances.resolve";
  await expect(
    run(
      {
        args: {
          context: {},
          path: "/reports/annual.summary",
          slot: "page.links",
        },
        name,
      },
      identity
    )
  ).resolves.toEqual([{ data: { id: "ITEM" }, key: "one", metadata: {} }]);
  await expect(
    run(
      {
        args: { context: {}, path: "/reports/annual.summary", slot: "panel" },
        name,
      },
      identity
    )
  ).resolves.toEqual([{ data: { count: 3 }, key: "two", metadata: {} }]);
  await Promise.all(
    [
      ["page.links", "/reports"],
      ["missing", "/reports/annual.summary"],
      ["__proto__", "/constructor"],
    ].map(async ([slot, path]) => {
      await expect(
        run({ args: { context: {}, path, slot }, name }, identity)
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    })
  );
  await Promise.all(
    [
      { context: {}, slot: "page.links" },
      { context: {}, path: "invalid", slot: "page.links" },
      { context: {}, path: "/", slot: "" },
    ].map(async (args) => {
      await expect(run({ args, name }, identity)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    })
  );
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});

it("binds backend tool calls to the active verified execution and closes escaped callers", async () => {
  let escaped: (() => Promise<{ amount: number }>) | undefined;
  const implementation = defineServer({
    read: action({
      args: z.undefined(),

      handler: async (ctx) => {
        expect(ctx.identity).toBe(identity);
        expect(ctx.scope).toBe(identity.scope);
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The dynamic tool registry erases this fixture-owned method signature. */
        // SAFETY: This fixture installs billing.read in the tool registry before capturing this capability.
        const billingTools = ctx.tools as {
          billing: {
            read: (input: { id: string }) => Promise<{ amount: number }>;
          };
        };
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        // oxlint-disable-next-line typescript/promise-function-async -- The captured capability must reject escaped access synchronously.
        escaped = () => billingTools.billing.read({ id: "invoice" });
        return await escaped();
      },
    }),
  });
  const calls = {
    mutate: async () => {},
    query: async () => {},
    tool: vi.fn().mockResolvedValue({ amount: 42 }),
  };
  const execute = createActionExecution(implementation);
  expect(await execute({ name: "read" }, identity, calls)).toEqual({
    amount: 42,
  });
  expect(calls.tool).toHaveBeenCalledExactlyOnceWith("billing.read", {
    id: "invoice",
  });
  expect(() => {
    void requireValue(escaped)();
  }).toThrow("Action has ended");
});
