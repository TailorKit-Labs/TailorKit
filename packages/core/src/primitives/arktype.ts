import { type } from "arktype";

import type { ComponentDefinition } from "../schema/index";
import { primitiveDefinitions, mapPrimitiveDefinitions } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

type FieldValidators = Record<string, Parameters<typeof type>[0]>;
type PrimitiveComponents = Record<
  PrimitiveName,
  ComponentDefinition & { children: true }
>;

const tokenExpr = (tokens: Record<string, string> | undefined): string => {
  const keys = Object.keys(tokens ?? {});
  if (keys.length === 0) {
    return "never";
  }
  return keys.map((key) => `'${key}'`).join(" | ");
};

const responsive = (expr: string, theme: TailorKitTheme) => {
  const fields: FieldValidators = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    fields[`${key}?`] = expr;
  }
  // SAFETY: expr comes from the predefined primitive validator table; this generic adapter constructs equivalent base and breakpoint validators, which Arktype cannot infer from a runtime definition.
  return type(expr as never)
    .or(fields)
    .onUndeclaredKey("reject");
};

const optionalResponsive = (expr: string, theme: TailorKitTheme) =>
  responsive(expr, theme);

const valueExpr = (values: readonly (number | string)[]): string =>
  values
    .map((value) => (isNumberValue(value) ? String(value) : `'${value}'`))
    .join(" | ");

const propExpr = (
  definition: PrimitivePropDefinition,
  theme: TailorKitTheme
) => {
  const expr =
    definition.kind === "token"
      ? tokenExpr(theme.tokens?.[definition.token])
      : valueExpr(definition.values);
  return definition.responsive === false
    ? expr
    : optionalResponsive(expr, theme);
};

const primitiveFields = (
  name: PrimitiveName,
  theme: TailorKitTheme
): FieldValidators =>
  Object.fromEntries(
    Object.entries(primitiveDefinitions[name]).map(([propName, definition]) => [
      `${propName}?`,
      propExpr(definition, theme),
    ])
  );

export const primitives = (theme: TailorKitTheme = {}): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);
  const components = mapPrimitiveDefinitions((name) => ({
    callbacks: {},
    children: true as const,
    fields: type(primitiveFields(name, resolvedTheme)).onDeepUndeclaredKey(
      "reject"
    ),
  }));
  return components;
};
