import { resolveTheme } from "@tailorkit/core/primitives/theme";
import type { TailorKitTheme } from "@tailorkit/core/schema";
import type { RemoteProps } from "@tailorkit/sandbox/protocol";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

type PrimitiveValue = number | string;

export type PrimitiveProps = RemoteProps;

const tokenGroups = [
  "size",
  "space",
  "radius",
  "background",
  "border",
  "borderColor",
  "textColor",
] as const;

const cssEscape = (value: string): string => {
  const css = globalThis.CSS;
  if (isFunctionValue(css?.escape)) {
    return css.escape(value);
  }
  return value.replaceAll(/[^A-Za-z0-9_-]/gu, "\\$&");
};

const toCssValue = (
  group: (typeof tokenGroups)[number] | "raw",
  value: PrimitiveValue
): string => {
  if (isNumberValue(value)) {
    return `${value}px`;
  }
  if (group === "raw") {
    return value;
  }
  return `var(--tailorkit-${group}-${cssEscape(value)})`;
};

const isPrimitiveValue = <TValue>(
  value: TValue
): value is TValue & PrimitiveValue =>
  typeof value === "string" || typeof value === "number";
const toResponsiveEntries = (
  value: RemoteProps[string]
): [string, PrimitiveValue][] => {
  if (isPrimitiveValue(value)) {
    return [["default", value]];
  }
  if (!isObjectValue(value) || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(
    ([breakpoint, entry]: [string, unknown]) =>
      isPrimitiveValue(entry)
        ? [[breakpoint, entry] satisfies [string, PrimitiveValue]]
        : []
  );
};

const toFlexAlignment = (value: PrimitiveValue): string => {
  if (value === "start") {
    return "flex-start";
  }
  if (value === "end") {
    return "flex-end";
  }
  return String(value);
};

const toFlexJustification = (value: PrimitiveValue): string => {
  if (value === "start") {
    return "flex-start";
  }
  if (value === "end") {
    return "flex-end";
  }
  if (value === "between") {
    return "space-between";
  }
  return String(value);
};

const declarationsForProp = (prop: string, value: PrimitiveValue): string[] => {
  if (prop === "columns") {
    return [`grid-template-columns: repeat(${String(value)}, minmax(0, 1fr));`];
  }
  const tokenDeclarations = new Map<
    string,
    [(typeof tokenGroups)[number], string]
  >([
    ["background", ["background", "background"]],
    ["border", ["border", "border"]],
    ["borderColor", ["borderColor", "border-color"]],
    ["textColor", ["textColor", "color"]],
  ]);
  const tokenDeclaration = tokenDeclarations.get(prop);
  if (tokenDeclaration) {
    const [group, property] = tokenDeclaration;
    if (prop === "border") {
      return [
        `border-style: ${toCssValue(group, value)};`,
        "border-width: 1px;",
      ];
    }
    return [`${property}: ${toCssValue(group, value)};`];
  }
  if (prop === "gap" || prop === "margin" || prop === "padding") {
    return [`${prop}: ${toCssValue("space", value)};`];
  }
  if (prop === "height" || prop === "width") {
    return [`${prop}: ${toCssValue("size", value)};`];
  }
  if (prop === "radius") {
    return [`border-radius: ${toCssValue("radius", value)};`];
  }
  if (prop === "align") {
    return [`align-items: ${toFlexAlignment(value)};`];
  }
  if (prop === "justify") {
    return [`justify-content: ${toFlexJustification(value)};`];
  }
  if (prop === "direction") {
    return [`flex-direction: ${toCssValue("raw", value)};`];
  }
  if (prop === "overflow") {
    return [`overflow: ${toCssValue("raw", value)};`];
  }
  if (prop === "grow") {
    return [`flex-grow: ${String(value)};`];
  }
  if (prop === "shrink") {
    return [`flex-shrink: ${String(value)};`];
  }
  if (prop === "minHeight") {
    return [`min-height: ${toCssValue("size", value)};`];
  }
  if (prop === "minWidth") {
    return [`min-width: ${toCssValue("size", value)};`];
  }
  if (prop === "basis") {
    return [`flex-basis: ${toCssValue("size", value)};`];
  }
  if (prop === "wrap") {
    return [`flex-wrap: ${toCssValue("raw", value)};`];
  }
  return [];
};

const buildStyleRules = (
  selector: string,
  props: PrimitiveProps,
  theme: TailorKitTheme,
  base: string[] = []
): string[] => {
  const responsiveRules: string[] = [];
  for (const [prop, rawValue] of Object.entries(props)) {
    for (const [breakpoint, value] of toResponsiveEntries(rawValue)) {
      const declarations = declarationsForProp(prop, value);
      if (declarations.length === 0) {
        continue;
      }
      if (breakpoint === "default") {
        base.push(...declarations);
        continue;
      }
      const minWidth = theme.breakpoints?.[breakpoint];
      if (!(minWidth !== undefined && minWidth !== null && minWidth !== "")) {
        continue;
      }
      // Keep each property's authored query order independent of other properties.
      responsiveRules.push(
        `@media (min-width: ${minWidth}) { ${selector} { ${declarations.join(" ")} } }`
      );
    }
  }
  const rules = base.length > 0 ? [`${selector} { ${base.join(" ")} }`] : [];
  return [...rules, ...responsiveRules];
};

// Order defines precedence when more than one interaction state is active.
const interactionStates = [
  ":hover",
  ":focus-visible",
  ":active",
  ":disabled",
] as const;

export const buildPrimitiveCss = ({
  display,
  nodeId,
  props,
  viewId,
  theme,
  pressable = false,
}: {
  display: "block" | "flex" | "grid" | "inline" | "inline-flex";
  nodeId: string;
  props: PrimitiveProps;
  viewId: string;
  theme: TailorKitTheme;
  pressable?: boolean;
}): string => {
  const selector = `[data-tailorkit-view="${cssEscape(viewId)}"] [data-tailorkit-node="${cssEscape(
    nodeId
  )}"]`;
  const base = pressable
    ? [
        "appearance: none;",
        "box-sizing: border-box;",
        "border: 0;",
        "padding: 0;",
        "margin: 0;",
        "font: inherit;",
        "color: inherit;",
        "text-align: inherit;",
        "background: transparent;",
        "cursor: pointer;",
      ]
    : [];
  base.push(`display: ${display};`);
  const rules = buildStyleRules(selector, props, theme, base);
  if (pressable) {
    rules.push(`${selector}:disabled { cursor: default; }`);
  }
  for (const state of interactionStates) {
    const stateProps: PrimitiveProps = {};
    for (const [prop, rawValue] of Object.entries(props)) {
      if (!isObjectValue(rawValue) || Array.isArray(rawValue)) {
        continue;
      }
      const conditions = new Map<string, PrimitiveProps[string]>(
        Object.entries(rawValue)
      );
      const value = conditions.get(state);
      if (value !== undefined) {
        stateProps[prop] = value;
      }
    }
    const pseudo =
      pressable && state !== ":disabled" ? `:enabled${state}` : state;
    const stateRules = buildStyleRules(
      `${selector}${pseudo}`,
      stateProps,
      theme
    ).join("\n");
    if (stateRules === "") {
      continue;
    }
    // Avoid sticky hover styling after a tap on touch devices.
    rules.push(
      state === ":hover"
        ? `@media (hover: hover) { ${stateRules} }`
        : stateRules
    );
  }
  return rules.join("\n");
};

export const buildThemeCss = (
  viewId: string,
  theme: TailorKitTheme
): string => {
  const selector = `[data-tailorkit-view="${cssEscape(viewId)}"]`;
  const declarations: string[] = [];
  const resolvedTheme = resolveTheme(theme);

  for (const group of tokenGroups) {
    for (const [name, value] of Object.entries(
      resolvedTheme.tokens?.[group] ?? {}
    )) {
      declarations.push(`--tailorkit-${group}-${cssEscape(name)}: ${value};`);
    }
  }

  return `${selector} { ${declarations.join(" ")} }`;
};
