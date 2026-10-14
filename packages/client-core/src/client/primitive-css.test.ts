import { expect, it } from "vite-plus/test";

import { buildThemeCss, buildPrimitiveCss } from "./primitive-css";

const theme = {
  breakpoints: {
    base: null,
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
  expect(css).toContain('[data-tailorkit-view="screen-1"]');
  expect(css).toContain("--tailorkit-border-solid: solid;");
  expect(css).toContain("--tailorkit-space-md: 8px;");
  expect(css).toContain("--tailorkit-background-surface: var(--background);");
  expect(css).toContain(
    "--tailorkit-textColor-muted: var(--muted-foreground);"
  );
});

it("builds responsive primitive CSS without rendering a component", () => {
  const css = buildPrimitiveCss({
    display: "flex",
    nodeId: "node",
    props: {
      align: "start",
      justify: "between",
      padding: "md",
      textColor: { base: "muted", lg: "foreground", missing: "foreground" },
      width: 320,
    },
    theme,
    viewId: "view",
  });
  expect(css).toContain(
    '[data-tailorkit-view="view"] [data-tailorkit-node="node"]'
  );
  expect(css).toContain("padding: var(--tailorkit-space-md)");
  expect(css).toContain("width: 320px");
  expect(css).toContain("align-items: flex-start");
  expect(css).toContain("justify-content: space-between");
  expect(css).toContain("@media (min-width: 1024px)");
  expect(css.match(/@media/gu)).toHaveLength(1);
});
