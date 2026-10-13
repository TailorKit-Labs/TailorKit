import { defineServer, fn } from "@tailorkit/app/server";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { installFetchGuard } from "./context";
import { resultValue } from "./errors";
import { createExecution } from "./execution";

const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
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
const endpoint = "https://example.com";

function setup() {
  installFetchGuard();
  // Like an SDK: capture fetch once, then use it from nested async helpers.
  const captured = globalThis.fetch;
  const read = fn.query.handler(() => {
    fetch(endpoint);
    return null;
  });
  const write = fn.mutation.handler(() => {
    fetch(endpoint);
    return null;
  });
  let detached: Promise<Response>;
  let release!: () => void;
  const app = defineServer({
    ended: fn.action.handler(() => {
      detached = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => captured(endpoint));
      detached.catch(() => {});
      return "done";
    }),
    nested: fn.action
      .functions({ read, write })
      .handler(async ({ queries, mutations }) => {
        await expect(queries.read()).rejects.toThrow(
          "only available inside actions"
        );
        await expect(mutations.write()).rejects.toThrow(
          "only available inside actions"
        );
        const response = await captured(endpoint);
        return response.text();
      }),
    read,
    run: fn.action.handler(async () => {
      await Promise.resolve();
      const response = await captured(endpoint);
      return response.text();
    }),
    write,
  });
  const execution = createExecution(app, {
    execute: () => ({ changes: 0, columns: [], rows: [] }),
    transaction: (run) => run(),
  });
  const calls = (value: string) => ({
    committed: vi.fn(async () => {}),
    fetch: vi.fn(async () => {
      await Promise.resolve();
      return new Response(value);
    }),
  });
  return {
    calls,
    detached: () => detached,
    execution,
    release: () => release(),
  };
}

it("guards queries, mutations and missing contexts, including nested calls", async () => {
  const { execution, calls } = setup();
  expect(() => fetch(endpoint)).toThrow("only available inside actions");
  expect(() => execution.query({ name: "read" }, identity)).toThrow(
    "only available inside actions"
  );
  expect(() =>
    execution.mutate(
      { name: "write", requestId: crypto.randomUUID() },
      identity
    )
  ).toThrow("only available inside actions");
  const result = await Effect.runPromise(
    execution.action(
      { name: "nested" },
      identity,
      calls("nested"),
      new AbortController().signal
    )
  );
  expect(result.result).toEqual({ ok: true, value: "nested" });
  expect(result).toMatchObject({ committed: false, tables: [] });
});

it("preserves concurrent action contexts and SDK-captured fetch", async () => {
  const { execution, calls } = setup();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      Effect.runPromise(
        execution.action(
          { name: "run" },
          identity,
          calls(String(i)),
          new AbortController().signal
        )
      )
    )
  );
  expect(results.map((result) => resultValue(result.result))).toEqual(
    Array.from({ length: 8 }, (_, i) => String(i))
  );
  expect(() => fetch(endpoint)).toThrow("only available inside actions");
});

it("revokes fetch in retained continuations after action completion", async () => {
  const test = setup();
  const calls = test.calls("unexpected");
  await Effect.runPromise(
    test.execution.action(
      { name: "ended" },
      identity,
      calls,
      new AbortController().signal
    )
  );
  test.release();
  await expect(test.detached()).rejects.toThrow("Action has ended");
  expect(calls.fetch).not.toHaveBeenCalled();
});
