export const primitiveNames = [
  "Box",
  "Flex",
  "Grid",
  "Inline",
  "Pressable",
] as const;

export type PrimitiveName = (typeof primitiveNames)[number];

export const mapPrimitiveDefinitions = <T>(
  create: (name: PrimitiveName) => T
): Record<PrimitiveName, T> => ({
  Box: create("Box"),
  Flex: create("Flex"),
  Grid: create("Grid"),
  Inline: create("Inline"),
  Pressable: create("Pressable"),
});

export type TokenName =
  | "background"
  | "border"
  | "borderColor"
  | "overflow"
  | "overflowWrap"
  | "radius"
  | "size"
  | "space"
  | "textAlign"
  | "textColor"
  | "textOverflow"
  | "textTransform";

export type PrimitivePropDefinition =
  | { kind: "boolean" }
  | { kind: "string" }
  | {
      kind: "token";
      token: TokenName;
      responsive?: boolean;
    }
  | {
      kind: "enum";
      values: readonly (number | string)[];
      responsive?: boolean;
    };

export type PrimitiveComponentDefinitions = Record<
  PrimitiveName,
  Record<string, PrimitivePropDefinition>
>;

const boxProps = {
  background: { kind: "token", responsive: true, token: "background" },
  basis: { kind: "token", responsive: true, token: "size" },
  border: { kind: "token", responsive: true, token: "border" },
  borderColor: { kind: "token", responsive: true, token: "borderColor" },
  grow: { kind: "enum", responsive: true, values: ["0", "1"] },
  height: { kind: "token", responsive: true, token: "size" },
  margin: { kind: "token", responsive: true, token: "space" },
  minHeight: { kind: "token", responsive: true, token: "size" },
  minWidth: { kind: "token", responsive: true, token: "size" },
  overflow: { kind: "token", responsive: true, token: "overflow" },
  overflowWrap: { kind: "token", responsive: true, token: "overflowWrap" },
  padding: { kind: "token", responsive: true, token: "space" },
  radius: { kind: "token", responsive: true, token: "radius" },
  shrink: { kind: "enum", responsive: true, values: ["0", "1"] },
  textAlign: { kind: "token", responsive: true, token: "textAlign" },
  textColor: { kind: "token", responsive: true, token: "textColor" },
  textOverflow: { kind: "token", responsive: true, token: "textOverflow" },
  textTransform: { kind: "token", responsive: true, token: "textTransform" },
  width: { kind: "token", responsive: true, token: "size" },
} as const satisfies Record<string, PrimitivePropDefinition>;

const inlineProps = {
  background: boxProps.background,
  borderColor: boxProps.borderColor,
  margin: boxProps.margin,
  overflowWrap: boxProps.overflowWrap,
  padding: boxProps.padding,
  radius: boxProps.radius,
  textAlign: boxProps.textAlign,
  textColor: boxProps.textColor,
  textOverflow: boxProps.textOverflow,
  textTransform: boxProps.textTransform,
} as const satisfies Record<string, PrimitivePropDefinition>;

const layoutDefinitions = {
  Box: boxProps,
  Flex: {
    ...boxProps,
    align: {
      kind: "enum",
      responsive: true,
      values: ["start", "center", "end", "stretch"],
    },
    direction: { kind: "enum", responsive: true, values: ["row", "column"] },
    gap: { kind: "token", responsive: true, token: "space" },
    justify: {
      kind: "enum",
      responsive: true,
      values: ["start", "center", "end", "between"],
    },
    wrap: {
      kind: "enum",
      responsive: true,
      values: ["wrap", "nowrap", "wrap-reverse"],
    },
  },
  Grid: {
    ...boxProps,
    columns: { kind: "enum", responsive: true, values: [1, 2, 3, 4, 6, 12] },
    gap: { kind: "token", responsive: true, token: "space" },
  },
  Inline: inlineProps,
} as const satisfies Omit<PrimitiveComponentDefinitions, "Pressable">;

const pressableStyleProps = {
  ...layoutDefinitions.Box,
  ...layoutDefinitions.Flex,
  ...layoutDefinitions.Grid,
} as const;

export const primitiveDefinitions = {
  ...layoutDefinitions,
  Pressable: {
    ...pressableStyleProps,
    ariaLabel: { kind: "string" },
    disabled: { kind: "boolean" },
    layout: {
      kind: "enum",
      responsive: false,
      values: ["inline", "box", "flex", "grid"],
    },
  },
} as const satisfies PrimitiveComponentDefinitions;

export const primitiveInteractionStates = [
  ":active",
  ":disabled",
  ":focus-visible",
  ":hover",
] as const;
