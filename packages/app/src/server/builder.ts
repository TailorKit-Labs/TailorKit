import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  DatabaseRelations,
  EmptyDatabaseRelations,
  DatabaseDefinition,
  QueryDatabase,
  MutationDatabase,
} from "@tailorkit/app-db";
import * as v from "valibot";

import type {
  ActionContext,
  EmptyFunctions,
  FunctionKind,
  Functions,
  Identity,
} from "./functions";

type HandlerContext<
  K extends FunctionKind,
  A extends StandardSchemaV1,
  F extends Functions,
  D extends DatabaseRelations,
> = {
  input: StandardSchemaV1.InferOutput<A>;
} & (K extends "action"
  ? ActionContext<F>
  : {
      db: K extends "query" ? QueryDatabase<D> : MutationDatabase<D>;
      identity: Identity;
    });

type OutputInput<R> = R extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<R>
  : unknown;
type HandlerOutput<K, O> = K extends "action"
  ? O | Promise<O>
  : O &
      ([O] extends [never]
        ? unknown
        : O extends PromiseLike<unknown>
          ? never
          : unknown);

type BuiltFunction<
  K extends FunctionKind,
  A extends StandardSchemaV1,
  R,
  O,
  F extends Functions,
  D extends DatabaseRelations,
> = {
  readonly kind: K;
  readonly args: A;
  readonly database?: DatabaseDefinition<D>;
  readonly handler: (
    context: Omit<HandlerContext<K, A, F, D>, "input"> & {
      args: StandardSchemaV1.InferOutput<A>;
    }
  ) => HandlerOutput<K, O>;
} & (R extends StandardSchemaV1 ? { readonly result: R } : unknown) &
  (K extends "action" ? { readonly functions: F } : unknown);

interface FunctionMetadata<R, F, D extends DatabaseRelations> {
  database?: DatabaseDefinition<D>;
  result?: R;
  functions?: F;
}

/** Immutable builders preserve the validated input and wire output types at every step. */
class FunctionBuilder<
  K extends FunctionKind,
  A extends StandardSchemaV1,
  R extends StandardSchemaV1 | undefined = undefined,
  F extends Functions = EmptyFunctions,
  D extends DatabaseRelations = EmptyDatabaseRelations,
> {
  private readonly kind: K;
  private readonly args: A;
  private readonly result: R;
  private readonly calls: F;
  private readonly databaseDefinition: DatabaseDefinition<D> | undefined;

  constructor(
    kind: K,
    args: A,
    result: R,
    calls: F,
    database?: DatabaseDefinition<D>
  ) {
    this.kind = kind;
    this.args = args;
    this.result = result;
    this.calls = calls;
    this.databaseDefinition = database;
  }

  input<S extends StandardSchemaV1>(schema: S) {
    return new FunctionBuilder(
      this.kind,
      schema,
      this.result,
      this.calls,
      this.databaseDefinition
    );
  }

  output<S extends StandardSchemaV1>(schema: S) {
    return new FunctionBuilder(
      this.kind,
      this.args,
      schema,
      this.calls,
      this.databaseDefinition
    );
  }

  functions<const G extends Functions>(
    this: FunctionBuilder<"action", A, R, F, D>,
    functions: G
  ) {
    return new FunctionBuilder(
      this.kind,
      this.args,
      this.result,
      functions,
      this.databaseDefinition
    );
  }

  handler<O extends OutputInput<R>>(
    handler: (context: HandlerContext<K, A, F, D>) => HandlerOutput<K, O>
  ): BuiltFunction<K, A, R, O, F, D> {
    const metadata: FunctionMetadata<R, F, D> = {};
    if (this.databaseDefinition) {
      metadata.database = this.databaseDefinition;
    }
    if (this.result) {
      metadata.result = this.result;
    }
    if (this.kind === "action") {
      metadata.functions = this.calls;
    }
    // SAFETY: The builder preserves its kind, schemas, database, and call definitions; optional metadata is added only for the matching generic branches.
    return (
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This builder or fixture preserves the declared capabilities across an erased generic boundary. */
      Object.freeze({
        ...metadata,
        args: this.args,

        handler: (
          context: Omit<HandlerContext<K, A, F, D>, "input"> & {
            args: StandardSchemaV1.InferOutput<A>;
          }
        ) =>
          // SAFETY: The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary.
          handler({
            ...context,
            input: context.args,
          } as unknown as HandlerContext<K, A, F, D>),

        kind: this.kind,
      }) as BuiltFunction<K, A, R, O, F, D>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
  }
}

/** Bind the app database once; handlers receive a scoped capability at execution. */
export const createFunctions = <
  const D extends DatabaseRelations = EmptyDatabaseRelations,
>(
  options: { database?: DatabaseDefinition<D> } = {}
) =>
  Object.freeze({
    action: new FunctionBuilder("action", v.undefined(), undefined, {}),
    mutation: new FunctionBuilder(
      "mutation",
      v.undefined(),
      undefined,
      {},
      options.database
    ),
    query: new FunctionBuilder(
      "query",
      v.undefined(),
      undefined,
      {},
      options.database
    ),
  });

export const fn = createFunctions();
