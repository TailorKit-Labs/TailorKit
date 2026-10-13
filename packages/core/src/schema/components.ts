import type { CallbackMap, Callbacks, InferCallbacks } from "./callbacks";
import type { EmptyObject, InferSchema, MergeProps, Schema } from "./shared";

type EmptyCallbackMap = Record<never, never>;

export type Fields = Schema;

export interface ComponentDefinition<
  TFields extends Fields | undefined = Fields | undefined,
  TCallbacks extends Callbacks = EmptyCallbackMap,
  TChildren extends boolean | undefined = boolean | undefined,
> {
  callbacks?: TCallbacks;
  fields?: TFields;
  children?: TChildren;
}

type AnyComponentDefinition = ComponentDefinition<
  Schema | undefined,
  CallbackMap,
  boolean | undefined
>;

export type ComponentDefinitions = Record<string, AnyComponentDefinition>;

export type ComponentProps<TComponent> = MergeProps<
  TComponent extends { fields: infer TFields }
    ? InferSchema<TFields>
    : EmptyObject,
  TComponent extends { callbacks: infer TCallbacks }
    ? InferCallbacks<TCallbacks>
    : EmptyObject
>;

export interface ResolvedComponentMetadata {
  callbacks: CallbackMap;
  fields?: Schema;
  children: boolean;
}

type FieldCallbackConflictKeys<TFields, TCallbacks> = Extract<
  string extends keyof InferSchema<TFields>
    ? never
    : string extends keyof TCallbacks
      ? never
      : Extract<keyof InferSchema<TFields>, keyof TCallbacks>,
  string
>;

type NoFieldCallbackConflicts<TFields, TCallbacks> =
  FieldCallbackConflictKeys<TFields, TCallbacks> extends never
    ? unknown
    : {
        readonly __tailorkit_error__: `Field and callback keys must be unique. Conflicting key: ${FieldCallbackConflictKeys<TFields, TCallbacks>}`;
      };

export type NoComponentFieldCallbackConflicts<TComponents> = {
  [TName in keyof TComponents]: TComponents[TName] extends ComponentDefinition<
    infer TFields,
    infer TCallbacks,
    boolean | undefined
  >
    ? NoFieldCallbackConflicts<TFields, TCallbacks>
    : unknown;
};

const getObjectKeys = (value: unknown): string[] => {
  if (!(value && typeof value === "object")) {
    return [];
  }

  if ("shape" in value) {
    const { shape } = value as { shape?: unknown };
    if (shape && typeof shape === "object") {
      return Object.keys(shape);
    }
  }

  if ("entries" in value) {
    const { entries } = value as { entries?: unknown };
    if (entries && typeof entries === "object") {
      return Object.keys(entries);
    }
  }

  return [];
};

const assertNoLocalFieldCallbackConflicts = (
  componentName: string,
  fieldKeys: readonly string[],
  callbackKeys: readonly string[]
): void => {
  const callbackKeySet = new Set(callbackKeys);
  for (const fieldKey of fieldKeys) {
    if (callbackKeySet.has(fieldKey)) {
      throw new Error(
        `Component "${componentName}" defines both a field and callback named "${fieldKey}". Use distinct names for serializable fields and function callbacks.`
      );
    }
  }
};

export const resolveComponentMetadata = (
  name: string,
  definition: ComponentDefinition
): ResolvedComponentMetadata => {
  const { fields } = definition;
  const fieldKeys = fields ? getObjectKeys(fields) : [];
  const callbackKeys = Object.keys(definition.callbacks ?? {});
  assertNoLocalFieldCallbackConflicts(name, fieldKeys, callbackKeys);

  return {
    callbacks: definition.callbacks ?? {},
    children: definition.children ?? false,
    fields,
  };
};

export type Component = AnyComponentDefinition;
export type Components = ComponentDefinitions;
