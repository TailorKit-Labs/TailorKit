import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";

import type { InferCallback, InferCallbacks } from "./callbacks";

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
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
expectTypeOf<InferCallback<Record<never, never>>>().toEqualTypeOf<() => void>();

expectTypeOf<
  InferCallbacks<{
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
    onClose: Record<never, never>;
    onLoad: LoadCallback;
    omitted: undefined;
  }>
>().toEqualTypeOf<{
  onClose: () => void;
  onLoad: () => Promise<{ ready: true }>;
}>();
