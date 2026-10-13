import * as v from "valibot";

import type { ComponentDefinition } from "../schema/index";
import { primitiveDefinitions, primitiveNames } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

type Schema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
type Shape = Record<string, Schema>;
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

const responsive = <T extends Schema>(
  schema: T,
  theme: TailorKitTheme
): Schema => {
  const shape: Shape = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    shape[key] = v.optional(schema);
  }
  return v.union([schema, v.strictObject(shape as v.ObjectEntries)]);
};

const optionalResponsive = <T extends Schema>(
  schema: T,
  theme: TailorKitTheme
): Schema => v.optional(responsive(schema, theme));

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

const primitiveShape = (name: PrimitiveName, theme: TailorKitTheme): Shape =>
  Object.fromEntries(
    Object.entries(primitiveDefinitions[name]).map(([propName, definition]) => [
      propName,
      propSchema(definition, theme),
    ])
  );

export const primitives = (theme: TailorKitTheme = {}): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);
  const components = {} as PrimitiveComponents;
  for (const name of primitiveNames) {
    components[name] = {
      callbacks: {},
      children: true,
      fields: v.strictObject(
        primitiveShape(name, resolvedTheme) as v.ObjectEntries
      ) as unknown as ComponentDefinition["fields"],
    };
  }
  return components;
};
