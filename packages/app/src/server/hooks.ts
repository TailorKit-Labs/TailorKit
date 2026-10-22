import * as v from "valibot";

import { AppError } from "#errors";
import type { PatchsmithServerFunctions } from "#views";

import { action, isFunction } from "./functions";
import type { ActionContext, AppDefinition, FunctionCalls } from "./functions";

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated host bindings augment this interface.
export interface PatchsmithHooks {}

export type HookName = Extract<keyof PatchsmithHooks, string>;

export type HookContext = Omit<
  ActionContext,
  "queries" | "mutations" | "actions"
> & {
  readonly queries: FunctionCalls<PatchsmithServerFunctions, "query">;
  readonly mutations: FunctionCalls<PatchsmithServerFunctions, "mutation">;
  readonly actions: FunctionCalls<PatchsmithServerFunctions, "action">;
};

export interface HookDefinition<TOutput = unknown> {
  readonly hook: string;
  readonly handler: (context: never) => TOutput;
}

type HookInput<N extends HookName> = PatchsmithHooks[N] extends {
  input: infer I;
}
  ? I
  : undefined;

type HookOutput<N extends HookName> = PatchsmithHooks[N] extends {
  output: infer O;
}
  ? O
  : never;

/** Bind an app handler to a hook declared by its host contract. */
export const defineHook = <const N extends HookName>(definition: {
  hook: N;
  handler: (
    context: HookContext & { readonly input: HookInput<N> }
  ) => HookOutput<N> | Promise<HookOutput<N>>;
}) => Object.freeze(definition);

export interface FileHook {
  name: string;
  definition: HookDefinition;
}

/** Build-generated entry points use the existing action runtime and its scoped capabilities. */
export const withHooks = (
  app: AppDefinition,
  hooks: readonly FileHook[]
): AppDefinition => {
  const registry = new Map<string, HookDefinition>();

  for (const { name, definition } of hooks) {
    if (name !== definition.hook) {
      throw new Error(
        `Hook "${definition.hook}" must match file hook "${name}".`
      );
    }

    if (registry.has(name)) {
      throw new Error(`Duplicate hook "${name}".`);
    }

    registry.set(name, definition);
  }

  const internal = app.functions._patchsmith;

  if (internal && (isFunction(internal) || Object.hasOwn(internal, "hooks"))) {
    throw new Error(
      "The _patchsmith.hooks namespace is reserved by Patchsmith."
    );
  }

  return Object.freeze({
    functions: Object.freeze({
      ...app.functions,
      _patchsmith: Object.freeze({
        ...internal,
        hooks: {
          invoke: action({
            args: v.object({
              hook: v.string(),
              input: v.optional(v.unknown()),
            }),
            functions: app.functions,
            handler: async ({ args, ...context }) => {
              if (context.identity.hook !== args.hook) {
                throw new AppError(
                  "FORBIDDEN",
                  "A host hook session is required"
                );
              }

              const definition = registry.get(args.hook);

              if (!definition) {
                throw new AppError("NOT_FOUND", "App hook not found");
              }

              // SAFETY: The host validates input against the named hook contract before issuing its scoped invocation; generated bindings preserve that contract in the app.
              const output = await definition.handler(
                /* oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The host validates the payload for this registered hook; its heterogeneous handler type is erased only at dispatch. */
                { ...context, input: args.input } as never
              );

              return { output };
            },
          }),
        },
      }),
    }),
  });
};
