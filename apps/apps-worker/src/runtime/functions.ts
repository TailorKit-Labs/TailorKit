import type { Invocation } from "@patchsmith/app/protocol";
import type {
  AppDefinition,
  Identity,
  FunctionKind,
  FunctionVisibility,
} from "@patchsmith/app/server";
import { z } from "zod";

import { AppError } from "./errors";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

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
      return undefined;
    }

    const next: RegisteredFunction | Functions | undefined = current[part];

    if (!(next !== undefined && next !== null)) {
      return undefined;
    }

    current = next;
  }

  return isFunction(current) ? current : undefined;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser, serializer, or runtime adapter handles arbitrary values before validating or encoding their domain representation.
const freezeIdentity = (value: unknown): void => {
  if (!isObjectValue(value) || Object.isFrozen(value)) {
    return;
  }

  for (const child of Object.values(value)) {
    freezeIdentity(child);
  }

  Object.freeze(value);
};

/** Access is selected by the runtime entry point, never by invocation input. */
export const requireFunction = (
  app: AppDefinition,
  name: string,
  kind: FunctionKind,
  access: FunctionVisibility = "public"
) => {
  const fn = resolveFunction(app.functions, name);

  if (
    !fn ||
    fn.kind !== kind ||
    (access === "public" && fn.visibility === "internal")
  ) {
    throw new AppError("NOT_FOUND", "App function not found");
  }

  return fn;
};

export const prepareFunction = (
  app: AppDefinition,
  input: Invocation,
  identity: Identity,
  kind: FunctionKind,
  access: FunctionVisibility = "public"
) => {
  if (identity.expiresAt <= Date.now()) {
    throw new AppError("UNAUTHORIZED", "App token expired");
  }

  freezeIdentity(identity);

  if (input.name === "_patchsmith.hooks.invoke") {
    if (access === "internal") {
      throw new AppError("FORBIDDEN", "Hooks can only be invoked by the host");
    }

    const hook = z.object({ hook: z.string() }).safeParse(input.args);

    if (!hook.success || identity.hook !== hook.data.hook) {
      throw new AppError("FORBIDDEN", "A host hook session is required");
    }
  }

  const fn = requireFunction(app, input.name, kind, access);

  const args = fn.args["~standard"].validate(input.args);

  if (args instanceof Promise) {
    // oxlint-disable-next-line promise/prefer-await-to-then -- Database dispatch must remain synchronous; drain an unsupported async validator before rejecting it.
    void args.catch(() => {
      // The synchronous boundary reports the failure below.
    });
    throw new AppError(
      "BAD_REQUEST",
      "Function arguments require synchronous validation"
    );
  }

  if (args.issues) {
    throw new AppError("BAD_REQUEST", "Invalid function arguments");
  }

  return { args: args.value, fn };
};

/** Validate serialization before a mutation can commit or an action can return. */
const jsonResultSchema = z.json();

export type FunctionValue = z.output<typeof jsonResultSchema>;

export const functionValue = (
  fn: RegisteredFunction,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser, serializer, or runtime adapter handles arbitrary values before validating or encoding their domain representation.
  initialValue: unknown
): FunctionValue => {
  let value = initialValue;

  if (fn.result) {
    const result = fn.result["~standard"].validate(value);

    if (result instanceof Promise) {
      // oxlint-disable-next-line promise/prefer-await-to-then -- Result validation runs before a synchronous database transaction commits.
      void result.catch(() => {
        // The synchronous boundary reports the failure below.
      });
      throw new AppError(
        "INTERNAL_SERVER_ERROR",
        "Function results require synchronous validation"
      );
    }

    if (result.issues) {
      throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
    }

    ({ value } = result);
  }

  const serialized = JSON.stringify(value ?? null);

  return jsonResultSchema.parse(JSON.parse(serialized));
};
