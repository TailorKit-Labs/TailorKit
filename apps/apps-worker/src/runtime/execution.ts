import { invocationSchema } from "@patchsmith/app/protocol";
import type { Invocation } from "@patchsmith/app/protocol";
import type { AppDefinition, Identity } from "@patchsmith/app/server";
import { Effect } from "effect";
import { catch as catchEffect } from "effect/Effect";
import * as v from "valibot";
import { z } from "zod";

import { createActionExecution } from "./actions";
import type { ActionServices } from "./actions";
import { inExecutionContext } from "./context";
import { databaseScope } from "./database/driver";
import type { Persistence } from "./database/driver";
import { migrateDatabase } from "./database/migrations";
import type { AppMigration } from "./database/migrations";
import { AppError, appError, failedResult } from "./errors";
import type { InvocationResult } from "./errors";
import { prepareFunction, functionValue } from "./functions";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

export { invocationSchema } from "@patchsmith/app/protocol";
export type { Invocation } from "@patchsmith/app/protocol";

export interface ExecutionResult {
  value: unknown;
  tables: string[];
}
export interface MutationResult extends ExecutionResult {
  committed: boolean;
}

export const createExecution = (
  app: AppDefinition,
  persistence: Persistence,
  migrations: readonly AppMigration[] = []
) => {
  migrateDatabase(persistence, migrations);
  persistence.execute(
    "CREATE TABLE IF NOT EXISTS patchsmith_receipts (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
    []
  );
  const execute = (
    input: Invocation,
    identity: Identity,
    kind: "query" | "mutation",
    tables?: Set<string>
  ): ExecutionResult => {
    const { fn, args } = prepareFunction(app, input, identity, kind);
    const scope = databaseScope(
      persistence,
      kind === "mutation",
      fn.database?.relations
    );
    try {
      // SAFETY: prepareFunction validated args using this registered function, and this transaction supplies its matching database capability.
      const value = inExecutionContext({ active: true, kind }, () =>
        fn.handler(
          /* oxlint-disable typescript/no-unsafe-type-assertion -- prepareFunction validated args using this registered function, and this transaction supplies its matching database capability. */
          { args, db: scope.db, identity } as never
          /* oxlint-enable typescript/no-unsafe-type-assertion */
        )
      );
      if (isObjectValue(value) && "then" in value) {
        // Revoke DB access before any continuation can run outside the transaction.
        void (async () => {
          try {
            await Promise.resolve(value);
          } catch {
            /* Intentionally no action is needed. */
          }
        })();
        throw new AppError("BAD_REQUEST", "App handlers must be synchronous");
      }
      const result = {
        tables: [...(kind === "query" ? scope.reads : scope.writes)],
        value: functionValue(fn, value),
      };
      return result;
    } finally {
      for (const table of kind === "query" ? scope.reads : scope.writes) {
        tables?.add(table);
      }
      scope.close();
    }
  };
  const mutate = (
    input: Invocation & { requestId: string },
    identity: Identity,
    tables?: Set<string>
  ): MutationResult => {
    if (identity.expiresAt <= Date.now()) {
      throw new AppError("UNAUTHORIZED", "App token expired");
    }
    z.uuid().parse(input.requestId);
    const fingerprint = JSON.stringify([
      identity.subjectId ?? null,
      identity.projectId,
      identity.appId,
      identity.installationId,
      input.name,
      input.args,
      ...(input.args === undefined ? ["undefined"] : []),
    ]);
    return persistence.transaction(() => {
      const [prior] = persistence.execute(
        "SELECT fingerprint, result FROM patchsmith_receipts WHERE id = ?",
        [input.requestId]
      ).rows;
      if (prior !== undefined && prior !== null) {
        if (prior[0] !== fingerprint) {
          throw new AppError(
            "CONFLICT",
            "Mutation ID was already used for different arguments or identity"
          );
        }
        const stored = z
          .object({
            tables: z.array(z.string()),
            value: z.unknown().optional(),
          })
          .parse(JSON.parse(z.string().parse(prior[1])));
        return { committed: false, tables: stored.tables, value: stored.value };
      }
      const result = execute(input, identity, "mutation", tables);
      persistence.execute(
        "INSERT INTO patchsmith_receipts (id, fingerprint, result) VALUES (?, ?, ?)",
        [input.requestId, fingerprint, JSON.stringify(result)]
      );
      return { ...result, committed: true };
    });
  };
  const action = createActionExecution(app);
  return {
    action: (
      input: Invocation,
      identity: Identity,
      services: ActionServices,
      signal: AbortSignal
    ): Effect.Effect<InvocationResult> =>
      Effect.tryPromise({
        catch: appError,
        try: async () =>
          await action(
            input,
            identity,
            {
              fetch: services.fetch,
              mutate: async (call) => {
                const result = mutate(call, identity);
                if (result.committed && result.tables.length) {
                  await services.committed(result.tables);
                }
                return result.value;
              },
              query: async (call) =>
                await (async () => {
                  await Promise.resolve();
                  return execute(call, identity, "query").value;
                })(),
              tool: services.tool,
            },
            signal
          ),
      }).pipe(
        Effect.map((value) => ({
          committed: false,
          result: { ok: true as const, value },
          tables: [],
        })),
        catchEffect((failure) =>
          Effect.succeed({
            committed: false,
            result: failedResult(failure),
            tables: [],
          })
        )
      ),
    call: (
      kind: "query" | "mutation",
      input: Invocation & { requestId?: string },
      identity: Identity
    ): Effect.Effect<InvocationResult> =>
      Effect.suspend(() => {
        const tables = new Set<string>();
        return Effect.try({
          catch: appError,
          try: () => {
            const parsed = v.safeParse(
              kind === "mutation"
                ? v.strictObject({
                    ...invocationSchema.entries,
                    requestId: v.pipe(v.string(), v.uuid()),
                  })
                : invocationSchema,
              input
            );
            if (!parsed.success) {
              throw new AppError("BAD_REQUEST", "Invalid database invocation");
            }
            // SAFETY: kind selected the mutation schema above, which required a UUID requestId before parsed.output reaches this branch.
            const result =
              kind === "mutation"
                ? mutate(
                    /* oxlint-disable typescript/no-unsafe-type-assertion -- kind selected the mutation schema above, which required a UUID requestId before parsed.output reaches this branch. */
                    parsed.output as Invocation & { requestId: string },
                    /* oxlint-enable typescript/no-unsafe-type-assertion */
                    identity,
                    tables
                  )
                : execute(parsed.output, identity, kind, tables);
            return {
              committed: "committed" in result && result.committed === true,
              result: { ok: true as const, value: result.value },
              tables: result.tables,
            };
          },
        }).pipe(
          catchEffect((err2) =>
            Effect.succeed({
              committed: false,
              result: failedResult(err2),
              tables: [...tables],
            })
          )
        );
      }),
    mutate,
    query: (input: Invocation, identity: Identity) =>
      execute(input, identity, "query"),
  };
};
