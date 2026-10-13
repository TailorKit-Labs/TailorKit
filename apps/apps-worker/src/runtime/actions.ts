import type { AppDefinition, Identity } from "@tailorkit/app/server";

import { inExecutionContext } from "./context";
import { AppError } from "./errors";
import type { Invocation } from "./execution";
import type { Functions } from "./functions";
import {
  isFunction,
  resolveFunction,
  prepareFunction,
  functionValue,
} from "./functions";

/** Host capability passed into each action invocation. */
export interface ActionCapability {
  fetch(request: Request, cancellation: ReadableStream): Promise<Response>;
  tool(path: string, input: unknown): Promise<unknown>;
  committed(tables: string[]): Promise<void>;
}

/** Action helpers call the local execution engine; app authors receive no raw database handle. */
export interface ActionCalls {
  tool?: (path: string, input: unknown) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
  query(input: Invocation): Promise<unknown>;
  mutate(input: Invocation & { requestId: string }): Promise<unknown>;
}

export function createActionExecution(app: AppDefinition) {
  type Call = (
    check: () => void,
    calls: ActionCalls
  ) => (args: unknown, options?: { requestId?: string }) => Promise<unknown>;
  interface Group {
    [name: string]: Group | Call;
  }
  const bindings = new Map<unknown, { queries: Group; mutations: Group }>();
  function compile(functions: Functions, prefix = "") {
    const queries: Group = Object.create(null);
    const mutations: Group = Object.create(null);
    for (const [key, definition] of Object.entries(functions)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (!isFunction(definition)) {
        const nested = compile(definition, name);
        if (Object.keys(nested.queries).length) {
          queries[key] = nested.queries;
        }
        if (Object.keys(nested.mutations).length) {
          mutations[key] = nested.mutations;
        }
        continue;
      }
      if (definition.kind === "action") {
        continue;
      }
      if (resolveFunction(app.functions, name) !== definition) {
        throw new AppError(
          "NOT_FOUND",
          "Action function is not registered in this app"
        );
      }
      const { kind } = definition;
      (kind === "query" ? queries : mutations)[key] =
        (check, calls) => (args, options) => {
          check();
          return kind === "query"
            ? calls.query({ args, name })
            : calls.mutate({
                args,
                name,
                requestId: options?.requestId ?? crypto.randomUUID(),
              });
        };
    }
    return { mutations, queries };
  }
  function bind(
    group: Group,
    check: () => void,
    calls: ActionCalls
  ): Record<string, unknown> {
    const bound = Object.create(null);
    for (const [key, entry] of Object.entries(group)) {
      bound[key] =
        typeof entry === "function"
          ? entry(check, calls)
          : bind(entry, check, calls);
    }
    return Object.freeze(bound);
  }
  function register(functions: Functions) {
    for (const definition of Object.values(functions)) {
      if (!isFunction(definition)) {
        register(definition);
        continue;
      }
      if (definition.kind !== "action") {
        continue;
      }
      bindings.set(definition, compile(definition.functions ?? {}));
    }
  }
  register(app.functions);
  return async (
    input: Invocation,
    identity: Identity,
    calls: ActionCalls,
    signal = new AbortController().signal
  ) => {
    const scope = {
      active: true,
      fetch: calls.fetch,
      kind: "action" as const,
      signal,
    };
    function check() {
      if (!scope.active || signal.aborted) {
        throw new AppError("UNAVAILABLE", "Action has ended");
      }
      if (identity.expiresAt <= Date.now()) {
        throw new AppError("UNAUTHORIZED", "App token expired");
      }
    }
    const createTools = (parts: string[] = []): unknown =>
      new Proxy(() => {}, {
        apply(_target, _this, args) {
          check();
          if (!calls.tool)
            throw new AppError("UNAVAILABLE", "Tool transport unavailable");
          return calls.tool(parts.join("."), args[0]).then((value) => {
            check();
            return value;
          });
        },
        get(_target, key) {
          if (typeof key !== "string" || key === "then") return undefined;
          if (["__proto__", "constructor", "prototype"].includes(key))
            throw new AppError("BAD_REQUEST", "Invalid tool path");
          return createTools([...parts, key]);
        },
      });
    check();
    const { fn, args } = prepareFunction(app, input, identity, "action");
    const binding = bindings.get(fn);
    if (!binding) {
      throw new AppError("NOT_FOUND", "App action not found");
    }
    try {
      const value = await inExecutionContext(scope, () =>
        fn.handler({
          args,
          identity,
          mutations: bind(binding.mutations, check, calls),
          queries: bind(binding.queries, check, calls),
          requestId: crypto.randomUUID(),
          scope: identity.scope,
          signal,
          tools: createTools(),
        } as never)
      );
      check();
      return functionValue(fn, value);
    } finally {
      scope.active = false;
    }
  };
}

export interface ActionServices {
  tool?: (path: string, input: unknown) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
  committed(tables: string[]): Promise<void>;
}
