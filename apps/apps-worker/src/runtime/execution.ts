import { invocationSchema } from "@tailorkit/app/protocol";
import type { Invocation } from "@tailorkit/app/protocol";
import type { AppDefinition, Identity } from "@tailorkit/app/server";
import { Effect } from "effect";
import { catch as catchEffect } from "effect/Effect";
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

export { invocationSchema } from "@tailorkit/app/protocol";
export type { Invocation } from "@tailorkit/app/protocol";

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
    "CREATE TABLE IF NOT EXISTS tailorkit_receipts (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
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
      const value = inExecutionContext({ active: true, kind }, () =>
        fn.handler({ args, db: scope.db, identity } as never)
      );
      if (value && typeof value === "object" && "then" in value) {
        // Revoke DB access before any continuation can run outside the transaction.
        void (async () => {
          try {
            return await Promise.resolve(value);
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
        "SELECT fingerprint, result FROM tailorkit_receipts WHERE id = ?",
        [input.requestId]
      ).rows;
      if (prior) {
        if (prior[0] !== fingerprint) {
          throw new AppError(
            "CONFLICT",
            "Mutation ID was already used for different arguments or identity"
          );
        }
        return { ...JSON.parse(String(prior[1])), committed: false };
      }
      const result = execute(input, identity, "mutation", tables);
      persistence.execute(
        "INSERT INTO tailorkit_receipts (id, fingerprint, result) VALUES (?, ?, ?)",
        [input.requestId, fingerprint, JSON.stringify(result)]
      );
      return { ...result, committed: true };
    });
  };
  const action = createActionExecution(app);
  return {
    action(
      input: Invocation,
      identity: Identity,
      services: ActionServices,
      signal: AbortSignal
    ): Effect.Effect<InvocationResult> {
      return Effect.tryPromise({
        catch: appError,
        try: () =>
          action(
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
              query: (call) =>
                (async () => {
                  void (await Promise.resolve());
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
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This is an Effect recovery operator or transport callback, not a Node-style completion callback.
        catchEffect((err) =>
          Effect.succeed({
            committed: false,
            result: failedResult(err),
            tables: [],
          })
        )
      );
    },
    call(
      kind: "query" | "mutation",
      input: Invocation & { requestId?: string },
      identity: Identity
    ): Effect.Effect<InvocationResult> {
      return Effect.suspend(() => {
        const tables = new Set<string>();
        return Effect.try({
          catch: appError,
          try: () => {
            const parsed = (
              kind === "mutation"
                ? invocationSchema.extend({ requestId: z.uuid() })
                : invocationSchema
            ).safeParse(input);
            if (!parsed.success) {
              throw new AppError("BAD_REQUEST", "Invalid database invocation");
            }
            const result =
              kind === "mutation"
                ? mutate(
                    parsed.data as Invocation & { requestId: string },
                    identity,
                    tables
                  )
                : execute(parsed.data, identity, kind, tables);
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
      });
    },
    mutate,
    query: (input: Invocation, identity: Identity) =>
      execute(input, identity, "query"),
  };
};
