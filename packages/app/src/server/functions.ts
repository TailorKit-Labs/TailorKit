import type {
  DatabaseRelations,
  EmptyDatabaseRelations,
  DatabaseDefinition,
  QueryDatabase,
  MutationDatabase,
} from "@patchsmith/app-db";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { PatchsmithServerTools } from "#client/tools";
import type { JsonValue } from "#validation";

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- Omitted function tables must have no keys so actions expose no undeclared capabilities.
export type EmptyFunctions = Record<never, never>;

export interface Identity {
  readonly subjectId: string;
  readonly scope: {
    name: string;
    value: Record<string, JsonValue>;
  };
  readonly toolUrl: string;
  readonly projectId: string;
  readonly appId: string;
  readonly installationId: string;
  readonly deploymentId: string;
  readonly expiresAt: number;
}

export type FunctionKind = "query" | "mutation" | "action";
export type FunctionResult<D> = D extends {
  result: infer R extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<R>
  : D extends { handler: (context: never) => infer O }
    ? Awaited<O>
    : never;
export type FunctionCalls<F, K extends "query" | "mutation"> = {
  readonly [
    N in keyof F as F[N] extends { kind: FunctionKind }
      ? F[N] extends { kind: K }
        ? N
        : never
      : N
  ]: F[N] extends {
    args: infer A extends StandardSchemaV1;
    handler: (context: never) => infer _Output;
  }
    ? K extends "mutation"
      ? (
          ...args: undefined extends StandardSchemaV1.InferInput<A>
            ? [
                args?: StandardSchemaV1.InferInput<A>,
                options?: { requestId?: string },
              ]
            : [
                args: StandardSchemaV1.InferInput<A>,
                options?: { requestId?: string },
              ]
        ) => Promise<FunctionResult<F[N]>>
      : (
          ...args: undefined extends StandardSchemaV1.InferInput<A>
            ? [args?: StandardSchemaV1.InferInput<A>]
            : [args: StandardSchemaV1.InferInput<A>]
        ) => Promise<FunctionResult<F[N]>>
    : F[N] extends Functions
      ? FunctionCalls<F[N], K>
      : never;
};

export interface ActionContext<F extends Functions = EmptyFunctions> {
  readonly identity: Identity;
  readonly tools: PatchsmithServerTools;
  readonly requestId: string;
  readonly scope: Identity["scope"];
  readonly signal: AbortSignal;
  readonly queries: FunctionCalls<F, "query">;
  readonly mutations: FunctionCalls<F, "mutation">;
}

export interface FunctionDefinition<
  K extends FunctionKind,
  A extends StandardSchemaV1,
  O,
  F extends Functions = EmptyFunctions,
  D extends DatabaseRelations = EmptyDatabaseRelations,
> {
  readonly kind: K;
  readonly args: A;
  readonly result?: StandardSchemaV1<unknown, O>;
  readonly handler: (
    context: { args: StandardSchemaV1.InferOutput<A> } & (K extends "action"
      ? ActionContext<F>
      : {
          db: K extends "query" ? QueryDatabase<D> : MutationDatabase<D>;
          identity: Identity;
        })
  ) => K extends "action" ? O | Promise<O> : O;
}

export const query = <A extends StandardSchemaV1, O>(
  definition: Omit<FunctionDefinition<"query", A, O>, "kind"> & {
    handler: FunctionDefinition<"query", A, O>["handler"] &
      ([O] extends [never]
        ? unknown
        : O extends PromiseLike<unknown>
          ? never
          : unknown);
  }
) => Object.freeze({ ...definition, kind: "query" as const });
export const mutation = <A extends StandardSchemaV1, O>(
  definition: Omit<FunctionDefinition<"mutation", A, O>, "kind"> & {
    handler: FunctionDefinition<"mutation", A, O>["handler"] &
      ([O] extends [never]
        ? unknown
        : O extends PromiseLike<unknown>
          ? never
          : unknown);
  }
) => Object.freeze({ ...definition, kind: "mutation" as const });

export const action = <
  A extends StandardSchemaV1,
  O,
  const F extends Functions = EmptyFunctions,
>(
  definition: Omit<FunctionDefinition<"action", A, O, F>, "kind"> & {
    functions?: F;
  }
) => Object.freeze({ ...definition, kind: "action" as const });

// Erasure is private to dispatch; the generic definitions preserve app argument/result types.
export interface RegisteredFunction<TOutput = unknown> {
  kind: FunctionKind;
  args: StandardSchemaV1;
  result?: StandardSchemaV1;
  handler: (context: never) => TOutput;
  functions?: Functions;
  database?: DatabaseDefinition;
}
export interface Functions {
  readonly [name: string]: RegisteredFunction | Functions;
}

export const isFunction = (
  value: RegisteredFunction | Functions
): value is RegisteredFunction =>
  typeof value.kind === "string" && typeof value.handler === "function";

const functionNamePattern = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u;

/** Declare the functions exposed by a module, preserving their inferred types. */
export const defineRouter = <const F extends Functions>(functions: F): F => {
  for (const [name, value] of Object.entries(functions)) {
    if (!functionNamePattern.test(name)) {
      throw new Error("Invalid function name");
    }
    if (!isFunction(value)) {
      defineRouter(value);
    }
  }
  return Object.freeze(functions);
};

export const defineServer = <const F extends Functions>(functions: F) =>
  Object.freeze({ functions: defineRouter(functions) });
export type AppDefinition = ReturnType<typeof defineServer>;
