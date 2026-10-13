export interface TailorKitTheme {
  /**
   * Responsive breakpoint names used by responsive primitive props.
   *
   * The `base` breakpoint should be `null`; every other value is used as a
   * CSS `min-width` media query.
   *
   * Defaults: `base: null`, `sm: "640px"`, `md: "768px"`,
   * `lg: "1024px"`, `xl: "1280px"`, `2xl: "1536px"`.
   */
  breakpoints?: Record<string, string | null>;
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
     * Defaults: `none`, `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`.
     */
    radius?: Record<string, string>;
    /**
     * Width and height tokens used by the `width` and `height` primitive props.
     *
     * Defaults: `0`, fractions from `1/2` through `11/12`, `full`, `min`,
     * `max`, and `fit`.
     */
    size?: Record<string, string>;
    /**
     * Spacing tokens used by the `padding`, `margin`, and `gap` primitive props.
     *
     * Defaults: `none`, `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`.
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
  "2xl": "1536px",
  base: null,
  lg: "1024px",
  md: "768px",
  sm: "640px",
  xl: "1280px",
} as const;

export const defaultSpace = {
  "2xl": "3rem",
  "2xs": "0.125rem",
  "3xl": "4.5rem",
  lg: "1.5rem",
  md: "1rem",
  none: "0rem",
  sm: "0.5rem",
  xl: "2rem",
  xs: "0.25rem",
} as const;

export const defaultRadius = {
  "2xl": "1.5rem",
  "2xs": "0.125rem",
  "3xl": "2rem",
  lg: "0.75rem",
  md: "0.5rem",
  none: "0rem",
  sm: "0.375rem",
  xl: "1rem",
  xs: "0.25rem",
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
  "0": "0px",
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

const defaultTokenGroups = {
  border: defaultBorder,
  overflow: defaultOverflow,
  overflowWrap: defaultOverflowWrap,
  radius: defaultRadius,
  size: defaultSize,
  space: defaultSpace,
  textAlign: defaultTextAlign,
  textOverflow: defaultTextOverflow,
  textTransform: defaultTextTransform,
} satisfies TailorKitTheme["tokens"];

const resolveTokens = (
  theme: TailorKitTheme | undefined
): TailorKitTheme["tokens"] => {
  const tokens = { ...theme?.tokens };

  for (const [key, value] of Object.entries(defaultTokenGroups)) {
    // SAFETY: The token group name is checked against the declared default token groups before indexing that table.
    const tokenKey = key as keyof typeof defaultTokenGroups;
    tokens[tokenKey] ??= value;
  }

  return tokens;
};

export const resolveTheme = (
  theme: TailorKitTheme | undefined
): TailorKitTheme => ({
  breakpoints: theme?.breakpoints ?? defaultBreakpoints,
  tokens: resolveTokens(theme),
});
