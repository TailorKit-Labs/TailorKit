import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";

import type {
  Component,
  ComponentProps,
  NoComponentFieldCallbackConflicts,
} from "./components";

interface Button {
  fields: z.ZodObject<{
    variant: z.ZodEnum<{ default: "default"; secondary: "secondary" }>;
  }>;
  callbacks: {
    // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
    onClick: Record<never, never>;
  };
  children: true;
}

expectTypeOf<ComponentProps<Button>>().toExtend<{
  variant: "default" | "secondary";
  onClick: () => void;
}>();

expectTypeOf<Button["children"]>().toEqualTypeOf<true>();

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const annotatedComponent: Component = {
  callbacks: {
    onValueChange: {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
      input: {} as z.ZodObject<{ value: z.ZodString }>,
    },
  },
};
void annotatedComponent;

expectTypeOf<
  NoComponentFieldCallbackConflicts<{
    Button: Button;
  }>
>().toExtend<{
  Button: unknown;
}>();

expectTypeOf<
  NoComponentFieldCallbackConflicts<{
    Button: {
      fields: z.ZodObject<{ onClick: z.ZodString }>;
      // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
      callbacks: { onClick: Record<never, never> };
    };
  }>
>().toExtend<{
  Button: {
    readonly __tailorkit_error__: "Field and callback keys must be unique. Conflicting key: onClick";
  };
}>();
