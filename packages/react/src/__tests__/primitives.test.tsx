import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";

import { PrimitiveThemeContext, primitives } from "../primitives";

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

describe("react primitives", () => {
  const contextValue1 = { theme, viewId: "screen-1" };
  it("renders a scoped primitive style with responsive rules", () => {
    render(
      // oxlint-disable-next-line react/jsx-no-constructed-context-values -- This fixture is created once outside the render callback and stays stable for the test.
      <PrimitiveThemeContext.Provider value={contextValue1}>
        {primitives.Flex({
          children: createElement("span", null, "Content"),
          props: {
            border: "solid",
            direction: { base: "column", lg: "row" },
            gap: "md",
            padding: { base: "md", lg: "lg" },
            textColor: { base: "muted", lg: "foreground" },
          },
        })}
      </PrimitiveThemeContext.Provider>
    );

    const content = screen.getByText("Content");
    const node = content.parentElement;
    const style = node?.querySelector("style");
    expect(node?.tagName).toBe("DIV");
    expect(style?.textContent).toContain("display: flex;");
    expect(style?.textContent).toContain(
      "border-style: var(--tailorkit-border-solid);"
    );
    expect(style?.textContent).toContain("border-width: 1px;");
    expect(style?.textContent).toContain("padding: var(--tailorkit-space-md);");
    expect(style?.textContent).toContain(
      "color: var(--tailorkit-textColor-muted);"
    );
    expect(style?.textContent).toContain("@media (min-width: 1024px)");
    expect(style?.textContent).toContain(
      "color: var(--tailorkit-textColor-foreground);"
    );
    expect(style?.textContent).toContain("flex-direction: row;");
  });

  const contextValue2 = { theme, viewId: "screen-2" };
  it("renders inline as a span", () => {
    render(
      // oxlint-disable-next-line react/jsx-no-constructed-context-values -- This fixture is created once outside the render callback and stays stable for the test.
      <PrimitiveThemeContext.Provider value={contextValue2}>
        {primitives.Inline({
          children: "Label",
          props: { padding: "md" },
        })}
      </PrimitiveThemeContext.Provider>
    );

    expect(screen.getByText("Label").tagName).toBe("SPAN");
  });
});
