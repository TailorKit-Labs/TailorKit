import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";

import type { InferCallback, InferCallbacks } from "./callbacks";
import type { EmptyDefinitionMap } from "./shared";

interface SaveCallback {
  input: z.ZodObject<{ title: z.ZodString; version: z.ZodNumber }>;
  output: z.ZodObject<{ saved: z.ZodBoolean }>;
}

interface LoadCallback {
  async: true;
  output: z.ZodObject<{ ready: z.ZodLiteral<true> }>;
}

expectTypeOf<InferCallback<SaveCallback>>().toEqualTypeOf<
  (input: { title: string; version: number }) => { saved: boolean }
>();

expectTypeOf<InferCallback<LoadCallback>>().toEqualTypeOf<
  () => Promise<{ ready: true }>
>();
expectTypeOf<InferCallback<EmptyDefinitionMap>>().toEqualTypeOf<() => void>();

expectTypeOf<
  InferCallbacks<{
    onClose: EmptyDefinitionMap;
    onLoad: LoadCallback;
    omitted: undefined;
  }>
>().toEqualTypeOf<{
  onClose: () => void;
  onLoad: () => Promise<{ ready: true }>;
}>();
