import type { Schema } from "@patchsmith/core/schema";

import type { ViewEntry } from "./view-context";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

export interface ViewContextDiagnostic {
  message: string;
  details?: unknown;
}

export type ViewContextResult = { value: unknown } | ViewContextDiagnostic;

/** Validate through the original schema and preserve its parsed output. */
export const validateViewContext = (
  entry: ViewEntry,
  schema: Schema | undefined
): ViewContextResult | Promise<ViewContextResult> => {
  if (entry.status !== "ready") {
    return { value: undefined };
  }

  const { context, view } = entry;

  if (!schema) {
    return {
      message: `Patchsmith view "${view}" is not declared in the contract.`,
    };
  }

  if (
    context !== undefined &&
    (context === null || !isObjectValue(context) || Array.isArray(context))
  ) {
    return {
      message: `Patchsmith view "${view}" requires an object context that matches the view's schema.`,
    };
  }

  const classify = (
    result: Awaited<ReturnType<Schema["~standard"]["validate"]>>
  ): ViewContextResult => {
    if (!result.issues) {
      return { value: result.value };
    }

    return context === undefined
      ? {
          message: `Patchsmith view "${view}" is ready without its required context. Supply context or set loading: true while it is unavailable.`,
        }
      : {
          details: result.issues,
          message: `Patchsmith view "${view}" received context that does not match the view's schema.`,
        };
  };

  const result = schema["~standard"].validate(context);

  return "then" in result
    ? (async () => classify(await result))()
    : classify(result);
};
