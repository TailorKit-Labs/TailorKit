/* oxlint-disable typescript/no-unsafe-argument -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import type { Invocation } from "@tailorkit/app/protocol";
import { fn, defineServer } from "@tailorkit/app/server";
import type { AppDefinition, Identity } from "@tailorkit/app/server";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createActionExecution } from "./actions";
import type { ActionCalls } from "./actions";
import type { Persistence } from "./database/driver";
import { createExecution, invocationSchema } from "./execution";

const actionRunner = (app: AppDefinition, calls: ActionCalls) => {
  const run = createActionExecution(app);
  return async (input: Invocation, identity: Identity, signal?: AbortSignal) =>
    await run(input, identity, calls, signal);
};

const identity = {
  appId: "a",
  deploymentId: "d",
  expiresAt: Date.now() + 300_000,
  installationId: "i",
  projectId: "p",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "u",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

const persistence: Persistence = {
  execute: () => ({ changes: 0, columns: [], rows: [] }),
  transaction: (run) => run(),
};

it("validates and transforms fluent inputs and outputs through the real execution path", () => {
  const app = defineServer({
    empty: fn.query.handler(({ input }) => {
      expect(input).toBeUndefined();
      return { inferred: "no schema needed" };
    }),
    invalid: fn.query.output(z.number().min(10)).handler(() => 1),
    nullable: fn.query.input(z.null()).handler(({ input }) => input),
    transformed: fn.query
      .input(z.object({ value: z.string().transform(Number) }))
      .output(z.string().transform(Number))
      .handler(({ input, identity: viewer }) => {
        expect(viewer.subjectId).toBe("u");
        expect(input.value).toBe(4);
        return String(input.value + 1);
      }),
  });
  const execute = createExecution(app, persistence);
  expect(
    execute.query({ args: { value: "4" }, name: "transformed" }, identity).value
  ).toBe(5);
  expect(() =>
    execute.query({ args: { value: 4 }, name: "transformed" }, identity)
  ).toThrow("Invalid function arguments");
  expect(execute.query({ name: "empty" }, identity).value).toEqual({
    inferred: "no schema needed",
  });
  expect(
    execute.query(invocationSchema.parse({ name: "empty" }), identity).value
  ).toEqual({
    inferred: "no schema needed",
  });
  for (const args of [{}, null, "unexpected"]) {
    expect(() => execute.query({ args, name: "empty" }, identity)).toThrow(
      "Invalid function arguments"
    );
  }
  expect(invocationSchema.parse({ args: undefined, name: "empty" })).toEqual({
    args: undefined,
    name: "empty",
  });
  expect(
    execute.query({ args: null, name: "nullable" }, identity).value
  ).toBeNull();
  expect(() => execute.query({ name: "invalid" }, identity)).toThrow(
    "Invalid function result"
  );
});

it("keeps builders immutable and provides typed action calls using registered functions", async () => {
  const functions = {
    read: fn.query.output(z.string().transform(Number)).handler(() => "4"),
  };
  const base = fn.action.functions(functions).output(z.number());
  const save = base
    .input(z.number())
    .handler(async ({ input, queries, signal }) => {
      expect(signal.aborted).toBe(false);
      return input + (await queries.read());
    });
  const other = base.input(z.string()).handler(({ input }) => input.length);
  expect(save.args.safeParse(2).success).toBe(true);
  expect(save.args.safeParse("2").success).toBe(false);
  expect(other.args.safeParse("2").success).toBe(true);

  const query = vi.fn<() => Promise<number>>().mockResolvedValue(4);
  const run = actionRunner(defineServer({ ...functions, save }), {
    mutate: vi.fn(),
    query,
  });
  expect(await run({ args: 2, name: "save" }, identity)).toBe(6);
  expect(query).toHaveBeenCalledWith({ args: undefined, name: "read" });
});

it("uses undefined input and infers returns for mutations and async actions without schemas", async () => {
  const functions = {
    read: fn.query.handler(({ input }) => {
      expect(input).toBeUndefined();
      return [1, 2];
    }),
    save: fn.mutation.handler(({ input }) => {
      expect(input).toBeUndefined();
      return { saved: true };
    }),
  };
  const perform = fn.action
    .functions(functions)
    .handler(async ({ input, queries, mutations }) => {
      expect(input).toBeUndefined();
      return { rows: await queries.read(), saved: await mutations.save() };
    });
  const app = defineServer({ ...functions, perform });
  expect(functions.read).not.toHaveProperty("result");
  expect(functions.save).not.toHaveProperty("result");
  expect(perform).not.toHaveProperty("result");
  const execute = createExecution(app, persistence);
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const query = vi.fn(async (input) => execute.query(input, identity).value);
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const mutate = vi.fn(async (input) => execute.mutate(input, identity).value);
  const run = actionRunner(app, { mutate, query });
  expect(await run({ name: "perform" }, identity)).toEqual({
    rows: [1, 2],
    saved: { saved: true },
  });
  expect(query).toHaveBeenCalledWith({ args: undefined, name: "read" });
  expect(mutate).toHaveBeenCalledWith({
    args: undefined,
    name: "save",
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matchers intentionally return any; this value is used only to describe an assertion, not as application data.
    requestId: expect.any(String),
  });
  await expect(run({ args: {}, name: "perform" }, identity)).rejects.toThrow(
    "Invalid function arguments"
  );
});

it("validates optional output schemas for synchronous and async actions", async () => {
  const app = defineServer({
    invalid: fn.action.output(z.number().min(10)).handler(() => 1),
    invalidAsync: fn.action
      .output(z.number().min(10))
      .handler(vi.fn<() => Promise<number>>().mockResolvedValue(1)),
    transformed: fn.action
      .output(z.string().transform(Number))
      .handler(vi.fn<() => Promise<string>>().mockResolvedValue("4")),
    valid: fn.action.output(z.number().min(10)).handler(() => 10),
  });
  const run = actionRunner(app, { mutate: vi.fn(), query: vi.fn() });
  expect(await run({ name: "valid" }, identity)).toBe(10);
  expect(await run({ name: "transformed" }, identity)).toBe(4);
  await Promise.all(
    ["invalid", "invalidAsync"].map(async (name) => {
      await expect(run({ name }, identity)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Invalid function result",
      });
    })
  );
});
