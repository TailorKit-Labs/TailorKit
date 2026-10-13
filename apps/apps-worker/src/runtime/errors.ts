import { appError } from "@tailorkit/app/client";
import type { AppError } from "@tailorkit/app/client";
import { Effect } from "effect";

export { AppError, appError } from "@tailorkit/app/client";

export type FunctionResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: { code: ReturnType<typeof appError>["code"]; message: string };
    };

/** One internal RPC envelope; HTTP encoding belongs to the transport. */
export interface InvocationResult {
  result: FunctionResult;
  tables: string[];
  committed: boolean;
}

export const failedResult = (error: unknown): FunctionResult => {
  const failure = appError(error);
  return { error: { code: failure.code, message: failure.message }, ok: false };
};

export const resultValue = (result: FunctionResult) => {
  if (!result.ok) {
    throw appError(result.error);
  }
  return result.value;
};

export const resultEffect = (
  result: FunctionResult
): Effect.Effect<unknown, AppError> =>
  result.ok
    ? Effect.succeed(result.value)
    : Effect.fail(appError(result.error));
