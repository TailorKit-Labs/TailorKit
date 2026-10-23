import type { PatchsmithServerFunctions } from "#views";

import type { ActionContext, FunctionCalls } from "./functions";

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
