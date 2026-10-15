import { createApi } from "@tailorkit/app/client";
import type { Invocation } from "@tailorkit/app/protocol";
import { fn, defineServer } from "@tailorkit/app/server";
import type { AppDefinition, Identity } from "@tailorkit/app/server";
import { expect, it, vi } from "vite-plus/test";

import { createActionExecution } from "./actions";
import type { ActionCalls } from "./actions";
import { createExecution, invocationSchema } from "./execution";
import { resolveFunction } from "./functions";

const actionRunner = (app: AppDefinition, calls: ActionCalls) => {
  const run = createActionExecution(app);
  return async (input: Invocation, identity: Identity, signal?: AbortSignal) =>
    await run(input, identity, calls, signal);
};

it("dispatches nested functions and preserves their names, identity, execution and typed action calls", async () => {
  const todos = {
    read: fn.query.handler(() => "rows"),
    save: fn.mutation.handler(() => "saved"),
  };
  const app = defineServer({
    tasks: {
      run: fn.action
        .functions({ todos })
        .handler(async ({ queries, mutations }) => ({
          rows: await queries.todos.read(),
          saved: await mutations.todos.save(),
        })),
    },
    todos,
  });
  expect(resolveFunction(app.functions, "todos.read")).toBe(todos.read);
  expect(resolveFunction(app.functions, "tasks.run")).toBe(
    app.functions.tasks.run
  );
  expect(resolveFunction(app.functions, "todos.constructor")).toBeUndefined();
  const api = createApi<typeof app.functions>();
  expect(api.todos.read.name).toBe("todos.read");
  expect(api.tasks.run.name).toBe("tasks.run");
  const identity = {
    appId: "a",
    deploymentId: "d",
    expiresAt: Date.now() + 60_000,
    installationId: "i",
    projectId: "p",
    scope: { name: "org", value: { id: "tenant" } },
    subjectId: "u",
    toolUrl: "https://host.test/api/tailorkit/tools/execute",
  };
  const execution = createExecution(app, {
    execute: () => ({ changes: 0, columns: [], rows: [] }),
    transaction: (run) => run(),
  });
  expect(
    execution.query(
      invocationSchema.parse({ name: api.todos.read.name }),
      identity
    ).value
  ).toBe("rows");

  const query = vi.fn<() => Promise<string>>().mockResolvedValue("rows");

  const mutate = vi.fn<() => Promise<string>>().mockResolvedValue("saved");
  const run = actionRunner(app, { mutate, query });
  await expect(run({ name: api.tasks.run.name }, identity)).resolves.toEqual({
    rows: "rows",
    saved: "saved",
  });
  expect(query).toHaveBeenCalledWith({ args: undefined, name: "todos.read" });
  const expectedRequestIdMatcher1: unknown = expect.any(String);
  expect(mutate).toHaveBeenCalledWith({
    args: undefined,
    name: "todos.save",
    requestId: expectedRequestIdMatcher1,
  });
});

it("validates names inside nested groups", () => {
  expect(() =>
    defineServer({ todos: { "invalid.name": fn.query.handler(() => null) } })
  ).toThrow("Invalid function name");
  for (const name of [
    "todos..read",
    ".read",
    "todos.__proto__",
    "todos.read.",
    "_other.instances.page",
    "_tailorkitExtra.instances.page",
    "todos._tailorkit.read",
    "_tailorkit.instances._page",
    "_tailorkit..page",
  ]) {
    expect(invocationSchema.safeParse({ name }).success).toBe(false);
  }
});

it("allows the reserved internal invocation namespace without allowing apps to register it", () => {
  for (const name of [
    "_tailorkit.instances.resolve",
    "_tailorkit.future.resolve",
  ]) {
    expect(invocationSchema.parse({ name })).toEqual({ name });
  }
  expect(() => defineServer({ _tailorkit: {} })).toThrow(
    "Invalid function name"
  );
});
