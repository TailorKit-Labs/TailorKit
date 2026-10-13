import { z } from "zod";

import type { ComponentDefinition } from "../schema/index";
import { primitiveDefinitions, primitiveNames } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

type Shape = Record<string, z.ZodTypeAny>;
type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
>;

const tokenEnum = (
  tokens: Record<string, string> | undefined
): z.ZodTypeAny => {
  const keys = Object.keys(tokens ?? {});
  if (keys.length === 0) {
    return z.never();
  }
  return z.enum(keys as [string, ...string[]]);
};

const valueEnum = (values: readonly (number | string)[]): z.ZodTypeAny => {
  const [first, ...rest] = values;
  if (first === undefined) {
    return z.never();
  }
  return z.union([z.literal(first), ...rest.map((value) => z.literal(value))]);
};

const responsive = (
  schema: z.ZodTypeAny,
  theme: TailorKitTheme
): z.ZodTypeAny => {
  const shape: Shape = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    shape[key] = schema.optional();
  }
  return z.union([schema, z.object(shape).strict()]);
};

const propSchema = (
  definition: PrimitivePropDefinition,
  theme: TailorKitTheme
): z.ZodTypeAny => {
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
  const components = {} as PrimitiveComponents;
  for (const name of primitiveNames) {
    components[name] = {
      callbacks: {},
      children: true,
      fields: z.object(
        Object.fromEntries(
          Object.entries(primitiveDefinitions[name]).map(
            ([propName, definition]) => [
              propName,
              propSchema(definition, resolvedTheme),
            ]
          )
        )
      ),
    };
  }
  return components;
};
