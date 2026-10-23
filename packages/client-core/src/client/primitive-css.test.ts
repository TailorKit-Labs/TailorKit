import {
  primitiveDefaults,
  resolveTheme,
} from "@patchsmith/core/primitives/theme";
import { expect, it } from "vite-plus/test";

import { buildThemeCss, buildPrimitiveCss } from "./primitive-css";

const theme = {
  breakpoints: {
    lg: "1024px",
    sm: "640px",
  },
  tokens: {
    background: {
      surface: "var(--background)",
    },
    borderColor: {
      default: "var(--border)",
    },
    radius: {
      md: "8px",
    },
    space: {
      lg: "16px",
      md: "8px",
    },
    textColor: {
      foreground: "var(--foreground)",
      muted: "var(--muted-foreground)",
    },
  },
};

it("builds view-scoped theme variables", () => {
  const css = buildThemeCss("screen-1", theme);
  expect(css).toContain('[data-patchsmith-view="screen-1"]');
  expect(css).toContain("--patchsmith-border-solid: solid;");
  expect(css).toContain("--patchsmith-size-full: 100%;");
  expect(css).toContain("--patchsmith-space-md: 8px;");
  expect(css).toContain("--patchsmith-background-surface: var(--background);");
  expect(css).toContain(
    "--patchsmith-textColor-muted: var(--muted-foreground);"
  );
});

it("emits Tailwind v4 default spacing, sizing, and radius values without legacy aliases", () => {
  const css = buildThemeCss("view", {});

  expect(css).toContain("--patchsmith-space-4: 1rem;");
  expect(css).toContain("--patchsmith-size-12: 3rem;");
  expect(css).toContain("--patchsmith-size-96: 24rem;");
  expect(css).toContain("--patchsmith-size-px: 1px;");
  expect(css).toContain("--patchsmith-size-auto: auto;");
  expect(css).toContain("--patchsmith-radius-xs: 0.125rem;");
  expect(css).toContain("--patchsmith-radius-sm: 0.25rem;");
  expect(css).toContain("--patchsmith-radius-md: 0.375rem;");
  expect(css).toContain("--patchsmith-radius-lg: 0.5rem;");
  expect(css).toContain("--patchsmith-radius-xl: 0.75rem;");
  expect(css).toContain("--patchsmith-radius-2xl: 1rem;");
  expect(css).toContain("--patchsmith-radius-3xl: 1.5rem;");
  expect(css).toContain("--patchsmith-radius-4xl: 2rem;");
  expect(css).toContain("--patchsmith-radius-full: calc(infinity * 1px);");
  expect(css).not.toContain("--patchsmith-space-md:");
  expect(css).not.toContain("--patchsmith-space-none:");
  expect(css).not.toContain("--patchsmith-radius-2xs:");
});

it("uses numeric size and space tokens in responsive and state styles", () => {
  const css = buildPrimitiveCss({
    display: "flex",
    nodeId: "node",
    props: {
      basis: "24",
      gap: "2",
      height: "12",
      minHeight: "0",
      minWidth: "px",
      padding: { ":hover": "6", default: "4" },
      radius: "lg",
      width: { default: "12", lg: "24" },
    },
    theme: resolveTheme({}),
    viewId: "view",
  });

  expect(css).toContain("flex-basis: var(--patchsmith-size-24);");
  expect(css).toContain("gap: var(--patchsmith-space-2);");
  expect(css).toContain("height: var(--patchsmith-size-12);");
  expect(css).toContain("min-height: var(--patchsmith-size-0);");
  expect(css).toContain("min-width: var(--patchsmith-size-px);");
  expect(css).toContain("padding: var(--patchsmith-space-4);");
  expect(css).toContain(":hover { padding: var(--patchsmith-space-6); }");
  expect(css).toContain("border-radius: var(--patchsmith-radius-lg);");
  expect(css).toContain("width: var(--patchsmith-size-12);");
  expect(css).toContain(
    '@media (min-width: 64rem) { [data-patchsmith-view="view"] [data-patchsmith-node="node"] { width: var(--patchsmith-size-24); } }'
  );
});

it("renders extended defaults and host overrides without changing other tokens", () => {
  const css = buildThemeCss("view", {
    tokens: {
      radius: { ...primitiveDefaults.radius, card: "0.625rem", lg: "1rem" },
      size: { ...primitiveDefaults.size, "128": "32rem" },
      space: { ...primitiveDefaults.space, "128": "32rem" },
    },
  });

  expect(css).toContain("--patchsmith-radius-card: 0.625rem;");
  expect(css).toContain("--patchsmith-radius-lg: 1rem;");
  expect(css).toContain("--patchsmith-radius-md: 0.375rem;");
  expect(css).toContain("--patchsmith-size-128: 32rem;");
  expect(css).toContain("--patchsmith-size-12: 3rem;");
  expect(css).toContain("--patchsmith-space-128: 32rem;");
  expect(css).toContain("--patchsmith-space-4: 1rem;");
});

it("builds responsive primitive CSS without rendering a component", () => {
  const css = buildPrimitiveCss({
    display: "flex",
    nodeId: "node",
    props: {
      align: "start",
      justify: "between",
      padding: "md",
      textColor: { default: "muted", lg: "foreground", missing: "foreground" },
      width: 320,
    },
    theme,
    viewId: "view",
  });

  expect(css).toContain(
    '[data-patchsmith-view="view"] [data-patchsmith-node="node"]'
  );
  expect(css).toContain("padding: var(--patchsmith-space-md)");
  expect(css).toContain("width: 320px");
  expect(css).toContain("align-items: flex-start");
  expect(css).toContain("justify-content: space-between");
  expect(css).toContain("@media (min-width: 1024px)");
  expect(css.match(/@media/gu)).toHaveLength(1);
});

it("builds responsive Pressable states in interaction precedence order", () => {
  const css = buildPrimitiveCss({
    display: "inline-flex",
    nodeId: "pressable",
    pressable: true,
    props: {
      background: { ":hover": "surface", default: "surface" },
      borderColor: { ":focus-visible": "default" },
      padding: {
        ":active": { default: "lg", sm: "md" },
        default: "md",
        lg: "lg",
      },
      textColor: { ":disabled": "muted" },
      width: "full",
    },
    theme,
    viewId: "view",
  });

  expect(css).toContain("appearance: none;");
  expect(css).toContain("display: inline-flex;");
  expect(css).toContain("width: var(--patchsmith-size-full);");
  expect(css).toContain("@media (hover: hover)");
  expect(css).toContain(
    ':not([aria-disabled="true"]):hover { background: var(--patchsmith-background-surface); }'
  );
  expect(css).toContain(
    ':not([aria-disabled="true"]):focus-visible { border-color: var(--patchsmith-borderColor-default); }'
  );
  expect(css).toContain("@media (min-width: 640px)");
  expect(css).toContain(
    ':not([aria-disabled="true"]):is(:active, [data-pressed]) { padding: var(--patchsmith-space-md); }'
  );
  expect(css).toContain(
    '[aria-disabled="true"] { color: var(--patchsmith-textColor-muted); }'
  );
  expect(css.indexOf(':not([aria-disabled="true"]):hover')).toBeLessThan(
    css.indexOf(':not([aria-disabled="true"]):focus-visible { border-color:')
  );
  expect(
    css.indexOf(':not([aria-disabled="true"]):focus-visible { border-color:')
  ).toBeLessThan(
    css.indexOf(':not([aria-disabled="true"]):is(:active, [data-pressed])')
  );
  expect(css).toContain("outline: auto;");
  expect(css).not.toContain(":enabled");
  expect(css).not.toContain(":disabled");
  expect(css).not.toContain("outline: none");
});

it("keeps per-prop state breakpoints scoped to their state", () => {
  const options = {
    display: "block" as const,
    nodeId: "node",
    props: { padding: { ":active": { lg: "lg" }, default: "md" } },
    theme,
    viewId: "view",
  };

  const css = buildPrimitiveCss({ ...options, pressable: true });
  expect(css).toContain("padding: var(--patchsmith-space-md);");
  expect(css).toContain(
    '@media (min-width: 1024px) { [data-patchsmith-view="view"] [data-patchsmith-node="node"]:not([aria-disabled="true"]):is(:active, [data-pressed]) { padding: var(--patchsmith-space-lg); } }'
  );
  expect(css).not.toContain(
    ':not([aria-disabled="true"]):is(:active, [data-pressed]) { padding: var(--patchsmith-space-md); }'
  );
  expect(buildPrimitiveCss(options)).toContain(
    ":active { padding: var(--patchsmith-space-lg); }"
  );
});

it("keeps breakpoint aliases separate from pseudo-classes", () => {
  const css = buildPrimitiveCss({
    display: "block",
    nodeId: "node",
    props: {
      padding: {
        ":hover": { default: "lg", hover: "md" },
        default: "md",
        hover: "lg",
      },
    },
    theme: { breakpoints: { hover: "900px" } },
    viewId: "view",
  });

  expect(css).toContain(
    '[data-patchsmith-node="node"] { display: block; padding: var(--patchsmith-space-md); }'
  );
  expect(css).toContain(
    '@media (min-width: 900px) { [data-patchsmith-view="view"] [data-patchsmith-node="node"] { padding: var(--patchsmith-space-lg); } }'
  );
  expect(css).toContain(
    '[data-patchsmith-node="node"]:hover { padding: var(--patchsmith-space-lg); }'
  );
  expect(css).toContain(
    '@media (min-width: 900px) { [data-patchsmith-view="view"] [data-patchsmith-node="node"]:hover { padding: var(--patchsmith-space-md); } }'
  );
});

it("preserves each property's breakpoint order when multiple queries match", () => {
  const css = buildPrimitiveCss({
    display: "block",
    nodeId: "node",
    props: {
      // oxlint-disable-next-line sort-keys -- Declaration order determines precedence for overlapping breakpoint queries.
      margin: { sm: "md", lg: "lg" },
      padding: { lg: "lg", sm: "md" },
    },
    theme,
    viewId: "view",
  });

  const rules = css.split("\n").filter((rule) => rule.startsWith("@media"));
  expect(rules).toHaveLength(4);
  expect(rules[0]).toContain("640px");
  expect(rules[0]).toContain("margin:");
  expect(rules[1]).toContain("1024px");
  expect(rules[1]).toContain("margin:");
  expect(rules[2]).toContain("1024px");
  expect(rules[2]).toContain("padding:");
  expect(rules[3]).toContain("640px");
  expect(rules[3]).toContain("padding:");
});
