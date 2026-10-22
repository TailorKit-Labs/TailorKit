import type { ToolBridge, PatchsmithServerTools } from "@patchsmith/app/client";
import type {
  AppDefinition,
  Identity,
  FunctionVisibility,
} from "@patchsmith/app/server";

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

interface NestedActionCalls extends ActionCalls {
  action: (input: Invocation) => Promise<ReturnType<typeof functionValue>>;
}

export const createActionExecution = (app: AppDefinition) => {
  type Call = (
    check: () => void,
    calls: NestedActionCalls
  ) => (
    args: Invocation["args"],
    options?: { requestId?: string }
  ) => ReturnType<ActionCalls["query"]>;

  interface Group {
    [name: string]: Group | Call;
  }

  const bindings = new Map<
    unknown,
    { queries: Group; mutations: Group; actions: Group }
  >();

  const compile = (functions: Functions, prefix = "") => {
    const actions: Group = {};
    Object.setPrototypeOf(actions, null);
    const queries: Group = {};
    Object.setPrototypeOf(queries, null);
    const mutations: Group = {};
    Object.setPrototypeOf(mutations, null);

    for (const [key, definition] of Object.entries(functions)) {
      const name = prefix ? `${prefix}.${key}` : key;

      if (!isFunction(definition)) {
        const nested = compile(definition, name);

        if (Object.keys(nested.actions).length) {
          actions[key] = nested.actions;
        }

        if (Object.keys(nested.queries).length) {
          queries[key] = nested.queries;
        }

        if (Object.keys(nested.mutations).length) {
          mutations[key] = nested.mutations;
        }

        continue;
      }

      if (resolveFunction(app.functions, name) !== definition) {
        throw new AppError(
          "NOT_FOUND",
          "Action function is not registered in this app"
        );
      }

      const { kind } = definition;

      const group = { action: actions, mutation: mutations, query: queries }[
        kind
      ];

      group[key] =
        // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
        (check, calls) => (args, options) => {
          check();

          if (kind === "action") {
            return calls.action({ args, name });
          }

          return kind === "query"
            ? calls.query({ args, name })
            : calls.mutate({
                args,
                name,
                requestId: options?.requestId ?? crypto.randomUUID(),
              });
        };
    }

    return { actions, mutations, queries };
  };

  const isCall = (entry: Group | Call): entry is Call =>
    typeof entry === "function";

  interface BoundGroup {
    [name: string]: BoundGroup | ReturnType<Call>;
  }

  const bind = (
    group: Group,
    check: () => void,
    calls: NestedActionCalls
  ): BoundGroup => {
    const bound: BoundGroup = {};
    Object.setPrototypeOf(bound, null);

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

  const run = async (
    input: Invocation,
    identity: Identity,
    calls: ActionCalls,
    initialSignal = new AbortController().signal,
    access: FunctionVisibility = "public"
  ): Promise<ReturnType<typeof functionValue>> => {
    const controller = new AbortController();
    const signal = AbortSignal.any([initialSignal, controller.signal]);

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

    const createTools = (parts: string[] = []): PatchsmithServerTools =>
      // SAFETY: The proxy handles calls through apply and every string property through get, recursively returning the same callable proxy contract.
      new Proxy(
        () => {
          throw new AppError(
            "UNAVAILABLE",
            "Tool proxy must dispatch through its apply handler"
          );
        },
        {
          // oxlint-disable-next-line typescript/promise-function-async -- These capability guards must throw synchronously before dispatching asynchronous work.
          apply: (_target, _this, args) => {
            check();

            if (!calls.tool) {
              throw new AppError("UNAVAILABLE", "Tool transport unavailable");
            }

            return calls.tool(parts.join("."), args[0]).then((value) => {
              check();

              return value;
            });
          },
          get: (_target, key) => {
            if (!isStringValue(key) || key === "then") {
              /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
              return undefined;
            }

            if (["__proto__", "constructor", "prototype"].includes(key)) {
              throw new AppError("BAD_REQUEST", "Invalid tool path");
            }

            return createTools([...parts, key]);
          },
        }
      );

    check();

    const { fn, args } = prepareFunction(
      app,
      input,
      identity,
      "action",
      access
    );

    const binding = bindings.get(fn);

    if (!binding) {
      throw new AppError("NOT_FOUND", "App action not found");
    }

    const nestedCalls: NestedActionCalls = {
      ...calls,
      action: async (invocation) => {
        check();

        const value = await run(
          invocation,
          identity,
          calls,
          signal,
          "internal"
        );

        check();

        return value;
      },
    };

    try {
      // SAFETY: prepareFunction validates args with this registered action schema, and compile binds only its declared query and mutation functions.
      const value = await inExecutionContext(scope, () =>
        fn.handler(
          /* oxlint-disable typescript/no-unsafe-type-assertion -- prepareFunction validates args with this registered action schema, and compile binds only its declared query and mutation functions. */
          {
            actions: bind(binding.actions, check, nestedCalls),
            args,
            identity,
            mutations: bind(binding.mutations, check, nestedCalls),
            queries: bind(binding.queries, check, nestedCalls),
            requestId: crypto.randomUUID(),
            scope: identity.scope,
            signal,
            tools: createTools(),
          } as never
          /* oxlint-enable typescript/no-unsafe-type-assertion */
        )
      );

      check();

      return functionValue(fn, value);
    } finally {
      scope.active = false;
      controller.abort();
    }
  };

  return run;
};

export interface ActionServices {
  tool?: ToolBridge["client"];
  fetch?: typeof globalThis.fetch;
  committed: (tables: string[]) => Promise<void>;
}
