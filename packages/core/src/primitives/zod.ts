import { z } from "zod";

import type { ComponentDefinition } from "#schema/index";

import { primitiveDefinitions, mapPrimitiveDefinitions } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

type FieldValidators = Record<string, z.ZodType>;
type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
>;

const tokenEnum = (tokens: Record<string, string> | undefined): z.ZodType => {
  const keys = Object.keys(tokens ?? {});
  if (keys.length === 0) {
    return z.never();
  }
  return z.enum(keys);
};

const valueEnum = (values: readonly (number | string)[]): z.ZodType => {
  const [first, ...rest] = values;
  if (first === undefined) {
    return z.never();
  }
  return z.union([z.literal(first), ...rest.map((value) => z.literal(value))]);
};

const responsive = (schema: z.ZodType, theme: TailorKitTheme): z.ZodType => {
  const fields: FieldValidators = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[key] = schema.optional();
  }
  return z.union([schema, z.object(fields).strict()]);
};

const propSchema = (
  definition: PrimitivePropDefinition,
  theme: TailorKitTheme
): z.ZodType => {
  const schema =
    definition.kind === "token"
      ? tokenEnum(theme.tokens?.[definition.token])
      : valueEnum(definition.values);
  return definition.responsive === false
    ? schema.optional()
    : responsive(schema, theme).optional();
};

export const primitives = (theme: TailorKitTheme = {}): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);
  const components = mapPrimitiveDefinitions((name) => ({
    callbacks: {},
    children: true as const,
    fields: z.object(
      Object.fromEntries(
        Object.entries<PrimitivePropDefinition>(primitiveDefinitions[name]).map(
          ([propName, definition]) => [
            propName,
            propSchema(definition, resolvedTheme),
          ]
        )
      )
    ),
  }));
  return components;
};
