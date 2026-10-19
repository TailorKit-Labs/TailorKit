import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";

import type {
  Component,
  ComponentProps,
  NoComponentFieldCallbackConflicts,
} from "./components";
import type { EmptyDefinitionMap } from "./shared";

interface Button {
  fields: z.ZodObject<{
    variant: z.ZodEnum<{ default: "default"; secondary: "secondary" }>;
  }>;
  callbacks: {
    onClick: EmptyDefinitionMap;
  };
  children: true;
}

expectTypeOf<ComponentProps<Button>>().toExtend<{
  variant: "default" | "secondary";
  onClick: () => void;
}>();

expectTypeOf<Button["children"]>().toEqualTypeOf<true>();

const annotatedComponent: Component = {
  callbacks: {
    onValueChange: {
      input: z.object({ value: z.string() }),
    },
  },
  description: "Controlled value with an onValueChange callback.",
};
void annotatedComponent;

expectTypeOf<ComponentProps<Button & { description: string }>>().toEqualTypeOf<
  ComponentProps<Button>
>();

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
      callbacks: { onClick: EmptyDefinitionMap };
    };
  }>
>().toExtend<{
  Button: {
    readonly __tailorkit_error__: "Field and callback keys must be unique. Conflicting key: onClick";
  };
}>();
