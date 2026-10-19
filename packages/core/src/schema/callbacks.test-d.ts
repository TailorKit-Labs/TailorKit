import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";

import type { InferCallback, InferCallbacks } from "./callbacks";
import type { EmptyDefinitionMap } from "./shared";

interface SaveCallback {
  input: z.ZodObject<{ title: z.ZodString; version: z.ZodNumber }>;
  output: z.ZodObject<{ saved: z.ZodBoolean }>;
}

interface LoadCallback {
  output: z.ZodObject<{ ready: z.ZodLiteral<true> }>;
}

expectTypeOf<InferCallback<SaveCallback>>().toEqualTypeOf<
  (input: {
    title: string;
    version: number;
  }) => { saved: boolean } | Promise<{ saved: boolean }>
>();

expectTypeOf<InferCallback<LoadCallback>>().toEqualTypeOf<
  () => { ready: true } | Promise<{ ready: true }>
>();
expectTypeOf<InferCallback<EmptyDefinitionMap>>().toEqualTypeOf<
  () => void | Promise<void>
>();

expectTypeOf<
  InferCallbacks<{
    onClose: EmptyDefinitionMap;
    onLoad: LoadCallback;
    omitted: undefined;
  }>
>().toEqualTypeOf<{
  onClose: () => void | Promise<void>;
  onLoad: () => { ready: true } | Promise<{ ready: true }>;
}>();

expectTypeOf<InferCallbacks<{ onSave: SaveCallback }, true>>().toEqualTypeOf<{
  onSave: (input: {
    title: string;
    version: number;
  }) => Promise<{ saved: boolean }>;
}>();
expectTypeOf<
  InferCallbacks<{ onClose: EmptyDefinitionMap; onLoad: LoadCallback }, true>
>().toEqualTypeOf<{
  onClose: () => Promise<void>;
  onLoad: () => Promise<{ ready: true }>;
}>();
