import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { EmptyDefinitionMap, Schema } from "./shared";

export type ContextDefinitions = Record<`/${string}`, Schema>;
export type ViewDefinition<TContext extends Schema = Schema> = TContext;
export type ViewDefinitions = ContextDefinitions;
export type View = Schema;
export type Views = ContextDefinitions;
export interface ResolvedViewMetadata {
  context?: Schema;
}

type OwnContext<T> =
  T extends StandardSchemaV1<unknown, infer TOutput>
    ? TOutput
    : EmptyDefinitionMap;
type ContextKeys<T> = T extends Record<string, never> ? never : keyof T;
type Ancestors<T, P extends string> = {
  [K in keyof T & string]: K extends P
    ? never
    : K extends "/"
      ? K
      : P extends `${K}/${string}`
        ? K
        : never;
}[keyof T & string];
type AncestorKeys<T, P extends string> = {
  [K in Ancestors<T, P>]: ContextKeys<OwnContext<T[K]>>;
}[Ancestors<T, P>];
export type ViewContextHierarchy<T> = {
  [P in keyof T]: P extends string
    ? Exclude<OwnContext<T[P]>, undefined> extends Record<
        string,
        StandardSchemaV1.InferOutput<Schema>
      >
      ? Extract<ContextKeys<OwnContext<T[P]>>, AncestorKeys<T, P>> extends never
        ? unknown
        : {
            readonly __tailorkit_error__: `View "${P}" redeclares an ancestor context field.`;
          }
      : {
          readonly __tailorkit_error__: `Context for "${P}" must be an object with named fields.`;
        }
    : unknown;
};

export type SlotDefinitions<TPath extends string = string> = Record<
  string,
  {
    views: readonly TPath[];
    multiple?: boolean;
    /** Layout and sizing guidance for app authors and agents. The host controls layout. */
    description?: string;
  }
>;
