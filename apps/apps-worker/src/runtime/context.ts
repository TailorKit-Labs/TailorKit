import { AsyncLocalStorage } from "node:async_hooks";

import type { FunctionKind } from "@tailorkit/app/server";

import { AppError } from "./errors";

export interface ExecutionContext {
  kind: FunctionKind;
  signal?: AbortSignal;
  active: boolean;
  fetch?: typeof globalThis.fetch;
}

const context = new AsyncLocalStorage<ExecutionContext>();

/** Install only in the untrusted runtime, before importing application modules. */
export const installFetchGuard = () => {
  // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
  globalThis.fetch = (input, init) => {
    const current = context.getStore();
    if (current?.kind !== "action") {
      throw new AppError("FORBIDDEN", "fetch is only available inside actions");
    }
    if (!current.active || current.signal?.aborted === true) {
      throw new AppError("UNAVAILABLE", "Action has ended");
    }
    if (!current.fetch) {
      throw new AppError("UNAVAILABLE", "Action fetch is unavailable");
    }
    return current.fetch(input, init);
  };
};

export const inExecutionContext = <A>(
  scope: ExecutionContext,
  run: () => A
): A => context.run(scope, run);
