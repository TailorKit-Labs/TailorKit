import { type } from "arktype";

import { Icon } from "#icons/arktype";
import type { ComponentDefinition } from "#schema/index";

import {
  primitiveDefinitions,
  primitiveInteractionStates,
  mapPrimitiveDefinitions,
} from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { PatchsmithTheme } from "./theme";

export { defaultBreakpoints, primitiveDefaults } from "./theme";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

type FieldValidators = Record<string, Parameters<typeof type>[0]>;

type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
> & { Icon: ReturnType<typeof Icon> };

const tokenExpr = (tokens: Record<string, string> | undefined): string => {
  const keys = Object.keys(tokens ?? {});

  if (keys.length === 0) {
    return "never";
  }

  return keys.map((key) => `'${key}'`).join(" | ");
};

const responsive = (
  expr: string,
  theme: PatchsmithTheme,
  interactive = true
): ReturnType<typeof type.raw> => {
  const fields: FieldValidators = {};
  fields["default?"] = expr;

  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[`${key}?`] = expr;
  }

  if (interactive) {
    const stateValue = responsive(expr, theme, false);

    for (const state of primitiveInteractionStates) {
      fields[`${state}?`] = stateValue;
    }
  }

  return type.raw(expr).or(fields).onDeepUndeclaredKey("reject");
};

const valueExpr = (values: readonly (number | string)[]): string =>
  values
    .map((value) => (isNumberValue(value) ? String(value) : `'${value}'`))
    .join(" | ");

const propExpr = (
  definition: PrimitivePropDefinition,
  theme: PatchsmithTheme
): Parameters<typeof type>[0] => {
  if (definition.kind === "boolean" || definition.kind === "string") {
    return definition.kind;
  }

  const expr =
    definition.kind === "token"
      ? tokenExpr(theme.tokens?.[definition.token])
      : valueExpr(definition.values);

  return definition.responsive === false ? expr : responsive(expr, theme);
};

const primitiveFields = (
  name: PrimitiveName,
  theme: PatchsmithTheme
): FieldValidators =>
  Object.fromEntries(
    Object.entries<PrimitivePropDefinition>(primitiveDefinitions[name]).map(
      ([propName, definition]) => [`${propName}?`, propExpr(definition, theme)]
    )
  );

export const primitives = (
  theme: PatchsmithTheme = {}
): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);

  const components = mapPrimitiveDefinitions((name) => ({
    callbacks: name === "Pressable" ? { onPress: {} } : {},
    children: true as const,
    fields: type(primitiveFields(name, resolvedTheme)).onDeepUndeclaredKey(
      "reject"
    ),
  }));

  return { ...components, Icon: Icon({ library: "lucide" }) };
};
