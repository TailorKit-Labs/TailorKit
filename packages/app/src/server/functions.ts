import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
import type { z } from "zod";

import type { TailorKitServerTools } from "#client/tools";
import type { DatabaseDefinition } from "#database/definition";
import type { QueryDatabase, MutationDatabase } from "#database/types";

// oxlint-disable-next-line typescript/no-generated-empty-object-type -- Omitted function tables must have no keys so actions expose no undeclared capabilities.
export type EmptyFunctions = Record<never, never>;

export interface Identity {
  readonly subjectId?: string;
  readonly scope: {
    name: string;
    value: Record<string, z.output<ReturnType<typeof z.json>>>;
  };
  readonly toolUrl: string;
  readonly projectId: string;
  readonly appId: string;
  readonly installationId: string;
  readonly deploymentId: string;
  readonly expiresAt: number;
}

export type FunctionKind = "query" | "mutation" | "action";
export type FunctionResult<D> = D extends { result: infer R extends z.ZodType }
  ? z.output<R>
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
    args: infer A extends z.ZodType;
    handler: (context: never) => infer _Output;
  }
    ? K extends "mutation"
      ? (
          ...args: undefined extends z.input<A>
            ? [args?: z.input<A>, options?: { requestId?: string }]
            : [args: z.input<A>, options?: { requestId?: string }]
        ) => Promise<FunctionResult<F[N]>>
      : (
          ...args: undefined extends z.input<A>
            ? [args?: z.input<A>]
            : [args: z.input<A>]
        ) => Promise<FunctionResult<F[N]>>
    : F[N] extends Functions
      ? FunctionCalls<F[N], K>
      : never;
};

export interface ActionContext<F extends Functions = EmptyFunctions> {
  readonly identity: Identity;
  readonly tools: TailorKitServerTools;
  readonly requestId: string;
  readonly scope: Identity["scope"];
  readonly signal: AbortSignal;
  readonly queries: FunctionCalls<F, "query">;
  readonly mutations: FunctionCalls<F, "mutation">;
}

export interface FunctionDefinition<
  K extends FunctionKind,
  A extends z.ZodType,
  O,
  F extends Functions = EmptyFunctions,
  D extends AnyRelations = EmptyRelations,
> {
  readonly kind: K;
  readonly args: A;
  readonly database?: K extends "action" ? never : DatabaseDefinition<D>;
  readonly result?: z.ZodType<O>;
  readonly handler: (
    context: { args: z.output<A> } & (K extends "action"
      ? ActionContext<F>
      : {
          db: K extends "query" ? QueryDatabase<D> : MutationDatabase<D>;
          identity: Identity;
        })
  ) => K extends "action" ? O | Promise<O> : O;
}

export const query = <
  A extends z.ZodType,
  O,
  const D extends AnyRelations = EmptyRelations,
>(
  definition: Omit<
    FunctionDefinition<"query", A, O, EmptyFunctions, D>,
    "kind"
  > & {
    handler: FunctionDefinition<"query", A, O, EmptyFunctions, D>["handler"] &
      ([O] extends [never]
        ? unknown
        : O extends PromiseLike<unknown>
          ? never
          : unknown);
  }
) => Object.freeze({ ...definition, kind: "query" as const });
export const mutation = <
  A extends z.ZodType,
  O,
  const D extends AnyRelations = EmptyRelations,
>(
  definition: Omit<
    FunctionDefinition<"mutation", A, O, EmptyFunctions, D>,
    "kind"
  > & {
    handler: FunctionDefinition<
      "mutation",
      A,
      O,
      EmptyFunctions,
      D
    >["handler"] &
      ([O] extends [never]
        ? unknown
        : O extends PromiseLike<unknown>
          ? never
          : unknown);
  }
) => Object.freeze({ ...definition, kind: "mutation" as const });

export const action = <
  A extends z.ZodType,
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
  args: z.ZodType;
  result?: z.ZodType;
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

export const defineServer = <const F extends Functions>(functions: F) => {
  for (const [name, value] of Object.entries(functions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(name)) {
      throw new Error("Invalid function name");
    }
    if (!isFunction(value)) {
      defineServer(value);
    }
  }
  return Object.freeze({ functions });
};
export type AppDefinition = ReturnType<typeof defineServer>;
