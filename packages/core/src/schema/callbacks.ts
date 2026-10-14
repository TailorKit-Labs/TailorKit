import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { EmptyObject, Schema } from "./shared";

export type CallbackMap = Record<string, CallbackDefinition | undefined>;
export type Callback = CallbackDefinition;
export type Callbacks = CallbackMap;

type VoidResult = ReturnType<() => void>;

type InferCallbackInput<TCallback> = TCallback extends {
  input?: infer TInput;
}
  ? TInput extends Schema
    ? StandardSchemaV1.InferOutput<TInput>
    : never
  : never;

type InferCallbackOutput<TCallback> = TCallback extends {
  output?: infer TOutput;
}
  ? TOutput extends Schema
    ? StandardSchemaV1.InferOutput<TOutput>
    : VoidResult
  : VoidResult;

type CallbackReturn<TCallback> = TCallback extends { async: true }
  ? Promise<InferCallbackOutput<TCallback>>
  : InferCallbackOutput<TCallback>;

export type InferCallback<TCallback> =
  InferCallbackInput<TCallback> extends never
    ? () => CallbackReturn<TCallback>
    : (input: InferCallbackInput<TCallback>) => CallbackReturn<TCallback>;

export type InferCallbacks<TCallbacks> =
  TCallbacks extends Record<string, CallbackMap[string]>
    ? string extends keyof TCallbacks
      ? EmptyObject
      : {
          [
            TKey in keyof TCallbacks as TCallbacks[TKey] extends undefined
              ? never
              : TKey
          ]: InferCallback<NonNullable<TCallbacks[TKey]>>;
        }
    : EmptyObject;

export interface CallbackDefinition<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
  TAsync extends boolean | undefined = boolean | undefined,
> {
  async?: TAsync;
  input?: TInput;
  output?: TOutput;
}
