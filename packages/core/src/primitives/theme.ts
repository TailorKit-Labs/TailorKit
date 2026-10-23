/** Host-defined media query aliases. Conditional style keys are reserved. */
export type ThemeBreakpoints = Record<string, string> & {
  default?: never;
  [state: `:${string}`]: never;
};

export interface PatchsmithTheme {
  /**
   * Responsive breakpoint names used by responsive primitive props.
   *
   * Values are used as CSS `min-width` media queries. Use `default` in style
   * values for the fallback; `default` and names starting with `:` are reserved.
   *
   * Tailwind v4 defaults: `sm: "40rem"`, `md: "48rem"`,
   * `lg: "64rem"`, `xl: "80rem"`, `2xl: "96rem"`.
   */
  breakpoints?: ThemeBreakpoints;
  tokens?: {
    /**
     * Background color tokens used by the `background` primitive prop.
     *
     * These values are emitted as CSS custom properties and can reference
     * application theme variables.
     *
     * Defaults: none.
     */
    background?: Record<string, string>;
    /**
     * Border style tokens used by the `border` primitive prop.
     *
     * Defaults: `solid`, `dashed`, `dotted`, `double`.
     */
    border?: Record<string, string>;
    /**
     * Border color tokens used by the `borderColor` primitive prop.
     *
     * These values are emitted as CSS custom properties and can reference
     * application theme variables.
     *
     * Defaults: none.
     */
    borderColor?: Record<string, string>;
    /**
     * Overflow behavior tokens used by the `overflow` primitive prop.
     *
     * Defaults: `visible`, `hidden`, `clip`, `scroll`, `auto`.
     */
    overflow?: Record<string, string>;
    /**
     * Text wrapping tokens used by the `overflowWrap` primitive prop.
     *
     * Defaults: `normal`, `breakWord`, `anywhere`.
     */
    overflowWrap?: Record<string, string>;
    /**
     * Corner radius tokens used by the `radius` primitive prop.
     *
     * Tailwind v4 defaults: `none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`,
     * `3xl`, `4xl`, `full`.
     */
    radius?: Record<string, string>;
    /**
     * Width and height tokens used by the `width` and `height` primitive props.
     *
     * Defaults: the numeric spacing tokens (for example, `12` is `3rem`),
     * `px`, fractions from `1/2` through `11/12`, `auto`, `full`, `min`,
     * `max`, and `fit`. Also used by `basis`, `minWidth`, and `minHeight`.
     */
    size?: Record<string, string>;
    /**
     * Spacing tokens used by the `padding`, `margin`, and `gap` primitive props.
     *
     * Defaults to `0`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`,
     * `3.5`, `4`–`12`, `14`, `16`, `18`, `20`, `24`, `28`, `32`, `36`,
     * `40`, `44`, `48`, `52`, `56`, `60`, `64`, `72`, `80`, `96`, and `px`.
     * Numeric tokens use a `0.25rem` unit, so `4` is `1rem`.
     */
    space?: Record<string, string>;
    /**
     * Text alignment tokens used by the `textAlign` primitive prop.
     *
     * Defaults: `left`, `right`, `start`, `end`, `center`, `justify`.
     */
    textAlign?: Record<string, string>;
    /**
     * Text color tokens used by the `textColor` primitive prop.
     *
     * These values are emitted as CSS custom properties and can reference
     * application theme variables.
     *
     * Defaults: none.
     */
    textColor?: Record<string, string>;
    /**
     * Text overflow tokens used by the `textOverflow` primitive prop.
     *
     * Defaults: `clip`, `ellipsis`.
     */
    textOverflow?: Record<string, string>;
    /**
     * Text transform tokens used by the `textTransform` primitive prop.
     *
     * Defaults: `capitalize`, `uppercase`, `lowercase`, `none`.
     */
    textTransform?: Record<string, string>;
  };
}

export const defaultBreakpoints = {
  "2xl": "96rem",
  lg: "64rem",
  md: "48rem",
  sm: "40rem",
  xl: "80rem",
} as const;

export const defaultSpace = {
  "0": "0rem",
  "0.5": "0.125rem",
  "1": "0.25rem",
  "1.5": "0.375rem",
  "10": "2.5rem",
  "11": "2.75rem",
  "12": "3rem",
  "14": "3.5rem",
  "16": "4rem",
  "18": "4.5rem",
  "2": "0.5rem",
  "2.5": "0.625rem",
  "20": "5rem",
  "24": "6rem",
  "28": "7rem",
  "3": "0.75rem",
  "3.5": "0.875rem",
  "32": "8rem",
  "36": "9rem",
  "4": "1rem",
  "40": "10rem",
  "44": "11rem",
  "48": "12rem",
  "5": "1.25rem",
  "52": "13rem",
  "56": "14rem",
  "6": "1.5rem",
  "60": "15rem",
  "64": "16rem",
  "7": "1.75rem",
  "72": "18rem",
  "8": "2rem",
  "80": "20rem",
  "9": "2.25rem",
  "96": "24rem",
  px: "1px",
} as const;

export const defaultRadius = {
  "2xl": "1rem",
  "3xl": "1.5rem",
  "4xl": "2rem",
  full: "calc(infinity * 1px)",
  lg: "0.5rem",
  md: "0.375rem",
  none: "0rem",
  sm: "0.25rem",
  xl: "0.75rem",
  xs: "0.125rem",
} as const;

export const defaultBorder = {
  dashed: "dashed",
  dotted: "dotted",
  double: "double",
  solid: "solid",
} as const;

export const defaultOverflow = {
  auto: "auto",
  clip: "clip",
  hidden: "hidden",
  scroll: "scroll",
  visible: "visible",
} as const;

export const defaultOverflowWrap = {
  anywhere: "anywhere",
  breakWord: "break-word",
  normal: "normal",
} as const;

export const defaultSize = {
  ...defaultSpace,
  "1/12": "8.333333%",
  "1/2": "50%",
  "1/3": "33.333333%",
  "1/4": "25%",
  "1/5": "20%",
  "1/6": "16.666667%",
  "10/12": "83.333333%",
  "11/12": "91.666667%",
  "2/12": "16.666667%",
  "2/3": "66.666667%",
  "2/4": "50%",
  "2/5": "40%",
  "2/6": "33.333333%",
  "3/12": "25%",
  "3/4": "75%",
  "3/5": "60%",
  "3/6": "50%",
  "4/12": "33.333333%",
  "4/5": "80%",
  "4/6": "66.666667%",
  "5/12": "41.666667%",
  "5/6": "83.333333%",
  "6/12": "50%",
  "7/12": "58.333333%",
  "8/12": "66.666667%",
  "9/12": "75%",
  auto: "auto",
  fit: "fit-content",
  full: "100%",
  max: "max-content",
  min: "min-content",
} as const;

export const defaultTextAlign = {
  center: "center",
  end: "end",
  justify: "justify",
  left: "left",
  right: "right",
  start: "start",
} as const;

export const defaultTextOverflow = {
  clip: "clip",
  ellipsis: "ellipsis",
} as const;

export const defaultTextTransform = {
  capitalize: "capitalize",
  lowercase: "lowercase",
  none: "none",
  uppercase: "uppercase",
} as const;

/** Spread a token group to extend its defaults when defining a host theme. */
export const primitiveDefaults = {
  border: defaultBorder,
  overflow: defaultOverflow,
  overflowWrap: defaultOverflowWrap,
  radius: defaultRadius,
  size: defaultSize,
  space: defaultSpace,
  textAlign: defaultTextAlign,
  textOverflow: defaultTextOverflow,
  textTransform: defaultTextTransform,
} as const satisfies PatchsmithTheme["tokens"];

const isTokenName = (name: string): name is keyof typeof primitiveDefaults =>
  Object.hasOwn(primitiveDefaults, name);

const resolveTokens = (
  theme: PatchsmithTheme | undefined
): PatchsmithTheme["tokens"] => {
  const tokens: NonNullable<PatchsmithTheme["tokens"]> = { ...theme?.tokens };

  for (const [key, value] of Object.entries(primitiveDefaults)) {
    if (isTokenName(key)) {
      tokens[key] ??= value;
    }
  }

  return tokens;
};

export const resolveTheme = (
  theme: PatchsmithTheme | undefined
): PatchsmithTheme => {
  const breakpoints = theme?.breakpoints ?? defaultBreakpoints;

  for (const name of Object.keys(breakpoints)) {
    if (name === "default" || name.startsWith(":")) {
      throw new Error(
        `Breakpoint name "${name}" is reserved for conditional styles.`
      );
    }
  }

  return { breakpoints, tokens: resolveTokens(theme) };
};
