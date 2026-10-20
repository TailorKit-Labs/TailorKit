import type { CallbackMap, Callbacks, InferCallbacks } from "./callbacks";
import type {
  EmptyDefinitionMap,
  EmptyObject,
  InferSchema,
  MergeProps,
  Schema,
} from "./shared";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

type EmptyCallbackMap = EmptyDefinitionMap;

export type Fields = Schema;

export interface ComponentDefinition<
  TFields extends Fields | undefined = Fields | undefined,
  TCallbacks extends Callbacks = EmptyCallbackMap,
  TChildren extends boolean | undefined = boolean | undefined,
> {
  /** Usage and behavior guidance included in generated app references. */
  description?: string;
  callbacks?: TCallbacks;
  fields?: TFields;
  children?: TChildren;
}

type AnyComponentDefinition = ComponentDefinition<
  Schema | undefined,
  CallbackMap
>;

export type ComponentDefinitions = Record<string, AnyComponentDefinition>;

export type ComponentProps<TComponent> = MergeProps<
  TComponent extends { fields: infer TFields }
    ? InferSchema<TFields>
    : EmptyObject,
  TComponent extends { callbacks: infer TCallbacks }
    ? InferCallbacks<TCallbacks, true>
    : EmptyObject
>;

export interface ResolvedComponentMetadata {
  description?: string;
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
        readonly __patchsmith_error__: `Field and callback keys must be unique. Conflicting key: ${FieldCallbackConflictKeys<TFields, TCallbacks>}`;
      };

export type NoComponentFieldCallbackConflicts<TComponents> = {
  [TName in keyof TComponents]: TComponents[TName] extends ComponentDefinition<
    infer TFields,
    infer TCallbacks
  >
    ? NoFieldCallbackConflicts<TFields, TCallbacks>
    : unknown;
};

const getObjectKeys = (value: Schema | undefined): string[] => {
  if (!(value && isObjectValue(value))) {
    return [];
  }

  if ("shape" in value) {
    const fields = value.shape;
    if (isObjectValue(fields)) {
      return Object.keys(fields);
    }
  }

  if ("entries" in value) {
    const { entries } = value;
    if (isObjectValue(entries)) {
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

export const assertComponentDescription = (
  name: string,
  definition: ComponentDefinition
): void => {
  if (
    definition.description !== undefined &&
    !isStringValue(definition.description)
  ) {
    throw new TypeError(`Component "${name}" description must be a string.`);
  }
};

export const resolveComponentMetadata = (
  name: string,
  definition: ComponentDefinition
): ResolvedComponentMetadata => {
  assertComponentDescription(name, definition);
  const { fields } = definition;
  const fieldKeys = fields ? getObjectKeys(fields) : [];
  const callbackKeys = Object.keys(definition.callbacks ?? {});
  assertNoLocalFieldCallbackConflicts(name, fieldKeys, callbackKeys);

  const metadata: ResolvedComponentMetadata = {
    callbacks: definition.callbacks ?? {},
    children: definition.children ?? false,
    fields,
  };
  if (definition.description !== undefined) {
    metadata.description = definition.description;
  }
  return metadata;
};

export type Component = AnyComponentDefinition;
export type Components = ComponentDefinitions;
