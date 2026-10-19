import { expectTypeOf, vi } from "vite-plus/test";
import { z } from "zod";

import { createTailorKitSchema } from "./schema";
import type { ComponentProps } from "./schema";

createTailorKitSchema({
  components: {
    Button: {
      children: true,
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
    },
  },
});

createTailorKitSchema({
  components: {},
  views: {
    "/pages": z.object({ userId: z.string() }),
    "/pages/detail": z.object({ pageId: z.string() }),
  },
});

const tailor = createTailorKitSchema({
  components: {
    Button: {
      children: true,
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
    },
  },
  views: {
    "/": z.object({}),
    "/customers/:customerId": z.object({ customerId: z.string() }),
  },
});

const component = tailor.components.Button;
const context = tailor.views["/customers/:customerId"];
void component;
void context;

const buttonProps: ComponentProps<typeof tailor.components.Button> = {
  variant: "default",
};
void buttonProps;

expectTypeOf<ComponentProps<typeof tailor.components.Button>>().toExtend<{
  variant: "default" | "secondary";
}>();
expectTypeOf<typeof tailor.components.Button.children>().toEqualTypeOf<true>();
expectTypeOf<typeof context>().toEqualTypeOf<
  z.ZodObject<{ customerId: z.ZodString }>
>();
const callbacks = createTailorKitSchema({
  components: {
    Dialog: {
      callbacks: {
        onClose: {},
        onLoad: {
          output: z.object({ ready: z.literal(true) }),
        },
        onSave: {
          input: z.object({ title: z.string(), version: z.number() }),
          output: z.object({ saved: z.boolean() }),
        },
      },
    },
  },
});

const dialogProps: ComponentProps<typeof callbacks.components.Dialog> = {
  onClose: async () => {
    await Promise.resolve();
  },
  onLoad: vi
    .fn<() => Promise<{ ready: true }>>()
    .mockResolvedValue({ ready: true }),
  onSave: async (input) => {
    expectTypeOf(input).toEqualTypeOf<{ title: string; version: number }>();
    return await Promise.resolve({ saved: true });
  },
};
void dialogProps;
expectTypeOf<ComponentProps<typeof callbacks.components.Dialog>>().toExtend<{
  onSave: (input: {
    title: string;
    version: number;
  }) => Promise<{ saved: boolean }>;
  onClose: () => Promise<void>;
  onLoad: () => Promise<{ ready: true }>;
}>();

createTailorKitSchema({
  components: {
    Button: {
      callbacks: {
        onClick: {},
      },
      children: true,
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
    },
  },
});

createTailorKitSchema({
  components: {
    // @ts-expect-error field and callback keys must still conflict when explicitly duplicated
    Button: {
      callbacks: {
        variant: {},
      },
      fields: z.object({
        variant: z.enum(["default", "secondary"]),
      }),
    },
  },
});

createTailorKitSchema({
  components: {},
  views: {
    "/": z.object({ workspaceId: z.string() }),
    // @ts-expect-error Each field has one owning view.
    "/users/detail": z.object({ workspaceId: z.string() }),
  },
});

createTailorKitSchema({
  components: {},
  slots: { navbar: { views: ["/"] }, panel: { views: ["/users"] } },
  views: { "/": z.object({}), "/users": z.object({}) },
});
createTailorKitSchema({
  components: {},

  // @ts-expect-error Slot lists can only reference declared views.
  slots: { panel: { views: ["/missing"] } },

  views: { "/": z.object({}) },
});

createTailorKitSchema({
  components: {},
  views: {
    // @ts-expect-error Arrays must be wrapped in an object field.
    "/array": z.array(z.string()),

    "/empty": z.object({}),

    // @ts-expect-error Null is not an object context.
    "/null": z.object({ id: z.string() }).nullable(),

    // @ts-expect-error Context composition requires named fields.
    "/number": z.number(),

    "/optional": z.object({ id: z.string() }).optional(),

    // @ts-expect-error Strings must be wrapped in an object field.
    "/string": z.string(),

    // @ts-expect-error Every member of a context union must be an object.
    "/union": z.union([z.object({ id: z.string() }), z.number()]),
  },
});
