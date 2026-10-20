import * as v from "valibot";

import type { ComponentDefinition } from "#schema/index";

import {
  primitiveDefinitions,
  primitiveInteractionStates,
  mapPrimitiveDefinitions,
} from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { PatchsmithTheme } from "./theme";

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

const responsive = (
  schema: Schema,
  theme: PatchsmithTheme,
  interactive = true
): Schema => {
  const fields: FieldValidators = {};
  fields.default = v.optional(schema);

  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[key] = v.optional(schema);
  }

  if (interactive) {
    const stateValue = v.optional(responsive(schema, theme, false));

    for (const state of primitiveInteractionStates) {
      fields[state] = stateValue;
    }
  }

  return v.union([schema, v.strictObject(fields)]);
};

const propSchema = (
  definition: PrimitivePropDefinition,
  theme: PatchsmithTheme
): Schema => {
  if (definition.kind === "boolean") {
    return v.optional(v.boolean());
  }

  if (definition.kind === "string") {
    return v.optional(v.string());
  }

  const schema =
    definition.kind === "token"
      ? tokenPicklist(theme.tokens?.[definition.token])
      : v.picklist(definition.values);

  return definition.responsive === false
    ? v.optional(schema)
    : v.optional(responsive(schema, theme));
};

const primitiveFields = (
  name: PrimitiveName,
  theme: PatchsmithTheme
): FieldValidators =>
  Object.fromEntries(
    Object.entries<PrimitivePropDefinition>(primitiveDefinitions[name]).map(
      ([propName, definition]) => [propName, propSchema(definition, theme)]
    )
  );

export const primitives = (
  theme: PatchsmithTheme = {}
): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);

  const components = mapPrimitiveDefinitions((name) => ({
    callbacks: name === "Pressable" ? { onPress: {} } : {},
    children: true as const,
    fields: v.strictObject(primitiveFields(name, resolvedTheme)),
  }));

  return components;
};
