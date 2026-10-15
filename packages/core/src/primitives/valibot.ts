import * as v from "valibot";

import type { ComponentDefinition } from "#schema/index";

import { primitiveDefinitions, mapPrimitiveDefinitions } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

type Schema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
type FieldValidators = Record<string, Schema>;
type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
>;

const tokenPicklist = (tokens: Record<string, string> | undefined): Schema => {
  const keys = Object.keys(tokens ?? {});
  if (keys.length === 0) {
    return v.never();
  }
  return v.picklist(keys);
};

const responsive = (schema: Schema, theme: TailorKitTheme): Schema => {
  const fields: FieldValidators = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[key] = v.optional(schema);
  }
  return v.union([schema, v.strictObject(fields)]);
};

const optionalResponsive = (schema: Schema, theme: TailorKitTheme): Schema =>
  v.optional(responsive(schema, theme));

const propSchema = (
  definition: PrimitivePropDefinition,
  theme: TailorKitTheme
): Schema => {
  const schema =
    definition.kind === "token"
      ? tokenPicklist(theme.tokens?.[definition.token])
      : v.picklist(definition.values);
  return definition.responsive === false
    ? v.optional(schema)
    : optionalResponsive(schema, theme);
};

const primitiveFields = (
  name: PrimitiveName,
  theme: TailorKitTheme
): FieldValidators =>
  Object.fromEntries(
    Object.entries<PrimitivePropDefinition>(primitiveDefinitions[name]).map(
      ([propName, definition]) => [propName, propSchema(definition, theme)]
    )
  );

export const primitives = (theme: TailorKitTheme = {}): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);
  const components = mapPrimitiveDefinitions((name) => ({
    callbacks: {},
    children: true as const,
    fields: v.strictObject(primitiveFields(name, resolvedTheme)),
  }));
  return components;
};
