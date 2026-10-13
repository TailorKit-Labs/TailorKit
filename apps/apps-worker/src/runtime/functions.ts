import type { Invocation } from "@tailorkit/app/protocol";
import type {
  AppDefinition,
  Identity,
  FunctionKind,
} from "@tailorkit/app/server";
import { z } from "zod";

import { AppError } from "./errors";

const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";

export type Functions = AppDefinition["functions"];
type RegisteredFunction = Exclude<Functions[string], Functions>;
export const isFunction = (
  value: Functions[string]
): value is RegisteredFunction =>
  typeof value.kind === "string" && typeof value.handler === "function";

export const resolveFunction = (
  functions: Functions,
  name: string
): RegisteredFunction | undefined => {
  let current: RegisteredFunction | Functions = functions;
  for (const part of name.split(".")) {
    if (isFunction(current) || !Object.hasOwn(current, part)) {
      return;
    }
    const next: RegisteredFunction | Functions | undefined = current[part];
    if (!next) {
      return;
    }
    current = next;
  }
  return isFunction(current) ? current : undefined;
};

const freezeIdentity = <TValue>(value: TValue): void => {
  if (!value || !isObjectValue(value) || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    freezeIdentity(child);
  }
  Object.freeze(value);
};

export const prepareFunction = (
  app: AppDefinition,
  input: Invocation,
  identity: Identity,
  kind: FunctionKind
) => {
  if (identity.expiresAt <= Date.now()) {
    throw new AppError("UNAUTHORIZED", "App token expired");
  }
  freezeIdentity(identity);
  const fn = resolveFunction(app.functions, input.name);
  if (!fn || fn.kind !== kind) {
    throw new AppError("NOT_FOUND", "App function not found");
  }
  const args = fn.args.safeParse(input.args);
  if (!args.success) {
    throw new AppError("BAD_REQUEST", "Invalid function arguments");
  }
  return { args: args.data, fn };
};

/** Validate serialization before a mutation can commit or an action can return. */
const jsonResultSchema = z.json();
export type FunctionValue = z.output<typeof jsonResultSchema>;
export const functionValue = <TValue>(
  fn: RegisteredFunction,
  initialValue: TValue
): FunctionValue => {
  let value: Parameters<RegisteredFunction["args"]["safeParse"]>[0] =
    initialValue;

  if (fn.result) {
    const result = fn.result.safeParse(value);
    if (!result.success) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
    }
    value = result.data;
  }
  const serialized = JSON.stringify(value ?? null);
  return jsonResultSchema.parse(JSON.parse(serialized));
};
