import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { EmptyObject, MaybePromise, Schema } from "./shared";

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

type CallbackReturn<TCallback, TRemote extends boolean> = TRemote extends true
  ? Promise<InferCallbackOutput<TCallback>>
  : MaybePromise<InferCallbackOutput<TCallback>>;

export type InferCallback<TCallback, TRemote extends boolean = false> =
  InferCallbackInput<TCallback> extends never
    ? () => CallbackReturn<TCallback, TRemote>
    : (
        input: InferCallbackInput<TCallback>
      ) => CallbackReturn<TCallback, TRemote>;

export type InferCallbacks<TCallbacks, TRemote extends boolean = false> =
  TCallbacks extends Record<string, CallbackMap[string]>
    ? string extends keyof TCallbacks
      ? EmptyObject
      : {
          [
            TKey in keyof TCallbacks as TCallbacks[TKey] extends undefined
              ? never
              : TKey
          ]: InferCallback<NonNullable<TCallbacks[TKey]>, TRemote>;
        }
    : EmptyObject;

export interface CallbackDefinition<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
> {
  input?: TInput;
  output?: TOutput;
}
