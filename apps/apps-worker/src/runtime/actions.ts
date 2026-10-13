import type { ToolBridge, TailorKitServerTools } from "@tailorkit/app/client";
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

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

/** Host capability passed into each action invocation. */
export interface ActionCapability {
  fetch: (request: Request, cancellation: ReadableStream) => Promise<Response>;
  tool: ToolBridge["client"];
  committed: (tables: string[]) => Promise<void>;
}

/** Action helpers call the local execution engine; app authors receive no raw database handle. */
// Each registered function schema owns its result; the execution coordinator holds heterogeneous registrations.
export interface ActionCalls<TOutput = unknown> {
  tool?: ToolBridge["client"];
  fetch?: typeof globalThis.fetch;
  query: (input: Invocation) => Promise<TOutput>;
  mutate: (input: Invocation & { requestId: string }) => Promise<TOutput>;
}

export const createActionExecution = (app: AppDefinition) => {
  type Call = (
    check: () => void,
    calls: ActionCalls
  ) => (
    args: Invocation["args"],
    options?: { requestId?: string }
  ) => ReturnType<ActionCalls["query"]>;
  interface Group {
    [name: string]: Group | Call;
  }
  const bindings = new Map<unknown, { queries: Group; mutations: Group }>();
  const compile = (functions: Functions, prefix = "") => {
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
  };
  const isCall = (entry: Group | Call): entry is Call =>
    typeof entry === "function";
  interface BoundGroup {
    [name: string]: BoundGroup | ReturnType<Call>;
  }
  const bind = (
    group: Group,
    check: () => void,
    calls: ActionCalls
  ): BoundGroup => {
    const bound: BoundGroup = Object.create(null);
    for (const [key, entry] of Object.entries(group)) {
      bound[key] = isCall(entry)
        ? entry(check, calls)
        : bind(entry, check, calls);
    }
    return Object.freeze(bound);
  };
  const register = (functions: Functions) => {
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
  };
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
    const check = () => {
      if (!scope.active || signal.aborted) {
        throw new AppError("UNAVAILABLE", "Action has ended");
      }
      if (identity.expiresAt <= Date.now()) {
        throw new AppError("UNAUTHORIZED", "App token expired");
      }
    };
    const createTools = (parts: string[] = []): TailorKitServerTools =>
      // SAFETY: The proxy handles calls through apply and every string property through get, recursively returning the same callable proxy contract.
      new Proxy(
        () =>
          Promise.reject(
            new AppError(
              "UNAVAILABLE",
              "Tool proxy must dispatch through its apply handler"
            )
          ),
        {
          apply(_target, _this, args) {
            check();
            if (!calls.tool) {
              throw new AppError("UNAVAILABLE", "Tool transport unavailable");
            }
            return calls.tool(parts.join("."), args[0]).then((value) => {
              check();
              return value;
            });
          },
          get(_target, key) {
            if (!isStringValue(key) || key === "then") {
              return;
            }
            if (["__proto__", "constructor", "prototype"].includes(key)) {
              throw new AppError("BAD_REQUEST", "Invalid tool path");
            }
            return createTools([...parts, key]);
          },
        }
      ) as TailorKitServerTools;
    check();
    const { fn, args } = prepareFunction(app, input, identity, "action");
    const binding = bindings.get(fn);
    if (!binding) {
      throw new AppError("NOT_FOUND", "App action not found");
    }
    try {
      // SAFETY: prepareFunction validates args with this registered action schema, and compile binds only its declared query and mutation functions.
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
};

export interface ActionServices {
  tool?: ToolBridge["client"];
  fetch?: typeof globalThis.fetch;
  committed: (tables: string[]) => Promise<void>;
}
