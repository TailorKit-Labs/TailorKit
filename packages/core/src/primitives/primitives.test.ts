import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { createPatchsmithSchema } from "#schema/schema";
import { resolveJsonSchema } from "#spec/schema-references";
import { PatchsmithSchemaSpec } from "#spec/spec";

import {
  defaultBreakpoints as arktypeBreakpoints,
  primitiveDefaults as arktypeDefaults,
  primitives as arktypePrimitives,
} from "./arktype";
import {
  defaultBreakpoints as valibotBreakpoints,
  primitiveDefaults as valibotDefaults,
  primitives as valibotPrimitives,
} from "./valibot";
import {
  defaultBreakpoints as zodBreakpoints,
  primitiveDefaults as zodDefaults,
  primitives as zodPrimitives,
} from "./zod";

const isValid = (
  schema: StandardSchemaV1 | undefined,
  value: Parameters<StandardSchemaV1["~standard"]["validate"]>[0]
): boolean => {
  if (!schema) {
    return false;
  }

  const result = schema["~standard"].validate(value);

  if (result instanceof Promise) {
    throw new TypeError(
      "Primitive schema tests require synchronous validators"
    );
  }

  return !result.issues;
};

describe("primitive schema components", () => {
  it.each([
    ["Zod", zodPrimitives, zodDefaults, zodBreakpoints],
    ["Valibot", valibotPrimitives, valibotDefaults, valibotBreakpoints],
    ["ArkType", arktypePrimitives, arktypeDefaults, arktypeBreakpoints],
  ] as const)(
    "extends exported defaults when defining the %s contract",
    (_name, define, defaults, breakpoints) => {
      const suite = define({
        breakpoints: { ...breakpoints, wide: "120rem" },
        tokens: {
          radius: { ...defaults.radius, card: "0.625rem", lg: "0.625rem" },
          size: { ...defaults.size, "128": "32rem" },
          space: { ...defaults.space, "128": "32rem" },
        },
      });

      expect(
        isValid(suite.Box.fields, {
          height: "12",
          padding: { default: "4", wide: "128" },
          radius: { default: "lg", sm: "card" },
          width: "128",
        })
      ).toBe(true);
      expect(isValid(suite.Box.fields, { radius: "unknown" })).toBe(false);
      expect(defaults.radius.lg).toBe("0.5rem");
    },
    // ArkType compiles every primitive with extended tokens and six breakpoints;
    // this real contract construction takes more than five seconds on CI.
    15_000
  );

  it.each([
    ["Zod", zodPrimitives],
    ["Valibot", valibotPrimitives],
    ["ArkType", arktypePrimitives],
  ] as const)("includes a leaf Icon in %s primitives", (_name, define) => {
    const { Icon } = define();
    expect(Icon.children).toBe(false);
    expect(isValid(Icon.fields, { name: "arrow-right", size: 16 })).toBe(true);
    expect(
      isValid(Icon.fields, { name: "future-lucide-icon-from-newer-sdk" })
    ).toBe(true);
    expect(isValid(Icon.fields, {})).toBe(false);
    expect(isValid(Icon.fields, { name: 123 })).toBe(false);
  });

  it("serializes Icon with the other primitives", () => {
    const serialized = createPatchsmithSchema({
      components: zodPrimitives(),
    }).serialize();

    expect(serialized.components.Icon).toMatchObject({
      children: false,
      fields: { required: ["name"] },
    });
    expect(v.safeParse(PatchsmithSchemaSpec, serialized).success).toBe(true);
  });

  const theme = {
    breakpoints: {
      lg: "1024px",
      sm: "640px",
    },
    tokens: {
      background: {
        muted: "var(--muted)",
        surface: "var(--background)",
      },
      borderColor: {
        default: "var(--border)",
      },
      radius: {
        md: "8px",
        sm: "4px",
      },
      space: {
        lg: "16px",
        md: "8px",
        sm: "4px",
      },
      textColor: {
        default: "var(--foreground)",
        muted: "var(--muted-foreground)",
      },
    },
  };

  const schema = createPatchsmithSchema({
    components: {
      ...zodPrimitives(theme),
    },
  });

  it("validates primitive token props against theme token names", () => {
    const box = schema.$internal.components.Box.fields;
    expect(
      isValid(box, { padding: "md", radius: "sm", textColor: "muted" })
    ).toBe(true);
    expect(isValid(box, { padding: "unknown" })).toBe(false);
    expect(isValid(box, { textColor: "unknown" })).toBe(false);
  });

  it("validates responsive primitive props against theme breakpoint names", () => {
    const flex = schema.$internal.components.Flex.fields;
    expect(
      isValid(flex, {
        direction: { default: "column", lg: "row" },
        gap: { sm: "md" },
      })
    ).toBe(true);
    expect(isValid(flex, { direction: { xl: "row" } })).toBe(false);
  });

  it("serializes primitive components without schema theme metadata", () => {
    expect("theme" in schema.serialize()).toBe(false);
    expect(schema.serialize().components.Box?.children).toBe(true);
  });

  it("serializes the Pressable callback and nested state styles", () => {
    const pressable = schema.serialize().components.Pressable;
    expect(pressable?.callbacks).toEqual({ onPress: {} });
    expect(pressable?.children).toBe(true);
    expect(pressable?.fields).toBeDefined();

    if (pressable?.fields) {
      expect(resolveJsonSchema(pressable.fields)).toHaveProperty(
        "properties.background.anyOf"
      );
    }

    expect(pressable?.fields).not.toHaveProperty("properties.states");
  });

  it.each([
    ["Zod", zodPrimitives],
    ["Valibot", valibotPrimitives],
    ["ArkType", arktypePrimitives],
  ] as const)(
    "validates Tailwind v4 default tokens with %s",
    (_name, define) => {
      const defaultSchema = createPatchsmithSchema({
        components: {
          ...define(),
        },
      });

      const box = defaultSchema.$internal.components.Box.fields;

      expect(
        isValid(box, { border: "solid", padding: "0.5", radius: "4xl" })
      ).toBe(true);
      expect(
        isValid(box, { height: "min", width: { default: "full", xl: "1/2" } })
      ).toBe(true);
      expect(
        isValid(box, { overflow: { default: "hidden", lg: "auto" } })
      ).toBe(true);
      expect(
        isValid(box, { overflowWrap: "breakWord", textOverflow: "ellipsis" })
      ).toBe(true);
      expect(
        isValid(box, { textAlign: { default: "start", lg: "center" } })
      ).toBe(true);
      expect(
        isValid(box, { textTransform: { default: "none", lg: "uppercase" } })
      ).toBe(true);

      for (const invalid of [
        { padding: "sm" },
        { margin: "none" },
        { radius: "2xs" },
        { radius: "base" },
        { radius: "card" },
        { width: "w-12" },
        { width: "128" },
        { width: 12 },
      ]) {
        expect(isValid(box, invalid)).toBe(false);
      }

      expect(
        isValid(defaultSchema.$internal.components.Flex.fields, { gap: "md" })
      ).toBe(false);
      expect(
        isValid(box, {
          basis: "24",
          height: "12",
          minHeight: "0",
          minWidth: "px",
          width: { default: "3.5", lg: "96" },
        })
      ).toBe(true);
      expect(isValid(box, { height: "auto", width: "auto" })).toBe(true);
      expect(isValid(box, { textColor: "foreground" })).toBe(false);
      expect(isValid(box, { height: "100px", width: "unknown" })).toBe(false);
      expect(isValid(box, { overflow: "overlay" })).toBe(false);
      expect(isValid(box, { overflowWrap: "break-word" })).toBe(false);
      expect(isValid(box, { textOverflow: "fade" })).toBe(false);
      expect(isValid(box, { textAlign: "middle" })).toBe(false);
      expect(isValid(box, { textTransform: "titlecase" })).toBe(false);
      expect(isValid(box, { padding: { default: "0", xl: "12" } })).toBe(true);
    }
  );

  it("validates Pressable styles and callbacks with every validator", () => {
    for (const suite of [
      zodPrimitives(theme),
      valibotPrimitives(theme),
      arktypePrimitives(theme),
    ]) {
      const pressable = suite.Pressable;

      // Omitted layout uses the host's inline default, never child inference.
      for (const layout of [undefined, "inline", "box", "flex", "grid"]) {
        const fields = layout === undefined ? {} : { layout };
        expect(isValid(pressable.fields, fields)).toBe(true);
      }

      expect(
        isValid(pressable.fields, {
          align: "center",
          columns: { default: 1, lg: 2 },
          direction: "column",
          gap: "sm",
          grow: "1",
          justify: "between",
          padding: { default: "sm", lg: "md" },
          wrap: "wrap",
        })
      ).toBe(true);
      expect(
        isValid(pressable.fields, {
          ariaLabel: "Open project",
          background: {
            ":active": { default: "muted", lg: "surface" },
            ":hover": "muted",
            default: "surface",
          },
          borderColor: { ":focus-visible": "default", default: "default" },
          disabled: false,
          layout: "flex",
          padding: { ":active": "sm", default: "sm", lg: "md" },
          textColor: { ":disabled": "muted", default: "default" },
        })
      ).toBe(true);

      for (const invalid of [
        { layout: "link" },
        { layout: { default: "inline", lg: "flex" } },
        { ariaLabel: 1 },
        { asChild: true },
        { onKeyDown: "sandbox-handler" },
        { tabIndex: 0 },
        { role: "link" },
        { background: { base: "muted" } },
        { background: { hover: "muted" } },
        { background: { ":custom": "muted" } },
        { disabled: "true" },
        { background: { ":hover": "unknown" } },
        { padding: { ":active": { missing: "md" } } },
        { background: { selected: "muted" } },
        { background: { ":hover": { ":active": "muted" } } },
        { background: { lg: { ":hover": "muted" } } },
        { layout: { ":hover": "flex" } },
        { states: { ":hover": { background: "muted" } } },
      ]) {
        expect(isValid(pressable.fields, invalid)).toBe(false);
      }

      expect(
        isValid(pressable.fields, {
          background: "surface",
          padding: { lg: "md" },
        })
      ).toBe(true);
      expect(
        isValid(suite.Box.fields, { background: { ":hover": "muted" } })
      ).toBe(true);
      expect(pressable.callbacks).toEqual({ onPress: {} });
      expect(pressable.children).toBe(true);
    }
  });

  it("provides equivalent Valibot and ArkType primitive schemas", () => {
    const themeValue = {
      breakpoints: {
        lg: "1024px",
      },
      tokens: {
        background: {
          muted: "var(--muted)",
        },
        radius: {
          sm: "4px",
        },
        space: {
          md: "8px",
        },
      },
    };

    const suites = [
      zodPrimitives(themeValue),
      valibotPrimitives(themeValue),
      arktypePrimitives(themeValue),
    ];

    for (const primitiveSuite of suites) {
      expect(
        isValid(primitiveSuite.Box.fields, { padding: "md", radius: "sm" })
      ).toBe(true);
      expect(isValid(primitiveSuite.Box.fields, { padding: "unknown" })).toBe(
        false
      );
      expect(
        isValid(primitiveSuite.Flex.fields, {
          direction: { default: "column", lg: "row" },
        })
      ).toBe(true);
      expect(
        isValid(primitiveSuite.Flex.fields, { direction: { xl: "row" } })
      ).toBe(false);
      expect(
        isValid(primitiveSuite.Grid.fields, { columns: 3, gap: { lg: "md" } })
      ).toBe(true);
      expect(isValid(primitiveSuite.Grid.fields, { columns: 5 })).toBe(false);
      expect(
        isValid(primitiveSuite.Inline.fields, {
          background: "muted",
          padding: "md",
        })
      ).toBe(true);
    }
  });
});

it("rejects reserved breakpoint names at runtime for every validator", () => {
  for (const create of [zodPrimitives, valibotPrimitives, arktypePrimitives]) {
    for (const name of ["default", ":hover", ":custom", ":"]) {
      expect(() => {
        // @ts-expect-error -- Exercise untyped configuration that bypasses the reserved-name type constraint.
        create({ breakpoints: { [name]: "640px" } });
      }).toThrow(
        `Breakpoint name "${name}" is reserved for conditional styles.`
      );
    }
  }
});

it("keeps default styles independent of user-defined breakpoint names", () => {
  for (const create of [zodPrimitives, valibotPrimitives, arktypePrimitives]) {
    const suite = create({
      breakpoints: { desktop: "1024px", hover: "640px" },
    });

    expect(
      isValid(suite.Box.fields, {
        padding: { ":hover": "8", default: "2", desktop: "4", hover: "6" },
      })
    ).toBe(true);
    expect(isValid(suite.Box.fields, { padding: { lg: "4" } })).toBe(false);
    expect(
      isValid(create({ breakpoints: {} }).Box.fields, {
        padding: { default: "2" },
      })
    ).toBe(true);
  }
});
