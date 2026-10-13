import { type } from "arktype";

import type { ComponentDefinition } from "../schema/index";
import { primitiveDefinitions, primitiveNames } from "./definition";
import type { PrimitiveName, PrimitivePropDefinition } from "./definition";
import { resolveTheme } from "./theme";
import type { TailorKitTheme } from "./theme";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Shape = Record<string, any>;
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
  const shape: Shape = {};
  for (const key of Object.keys(theme.breakpoints ?? {})) {
    shape[`${key}?`] = expr;
  }
  return type(expr as never)
    .or(shape)
    .onUndeclaredKey("reject");
};

const optionalResponsive = (expr: string, theme: TailorKitTheme) =>
  responsive(expr, theme);

const valueExpr = (values: readonly (number | string)[]): string =>
  values
    .map((value) => (typeof value === "number" ? String(value) : `'${value}'`))
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

const primitiveShape = (name: PrimitiveName, theme: TailorKitTheme): Shape =>
  Object.fromEntries(
    Object.entries(primitiveDefinitions[name]).map(([propName, definition]) => [
      `${propName}?`,
      propExpr(definition, theme),
    ])
  );

export const primitives = (theme: TailorKitTheme = {}): PrimitiveComponents => {
  const resolvedTheme = resolveTheme(theme);
  const components = {} as PrimitiveComponents;
  for (const name of primitiveNames) {
    components[name] = {
      callbacks: {},
      children: true,
      fields: type(primitiveShape(name, resolvedTheme)).onDeepUndeclaredKey(
        "reject"
      ),
    };
  }
  return components;
};
