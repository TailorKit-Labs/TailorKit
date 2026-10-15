import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PrimitiveThemeContext, primitives } from "#primitives";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

const contextValue1 = { theme, viewId: "screen-1" };
const contextValue2 = { theme, viewId: "screen-2" };

describe("react primitives", () => {
  it("loads Icon only when rendered and shares its cache across mounts", async () => {
    const fetchIcon = vi.fn<typeof fetch>(
      async () =>
        await Promise.resolve(
          Response.json({
            nodes: [["path", { d: "M5 12h14" }]],
            size: 24,
          })
        )
    );
    vi.stubGlobal("fetch", fetchIcon);
    const view = render(primitives.Box({ props: {} }));
    expect(fetchIcon).not.toHaveBeenCalled();

    view.rerender(primitives.Icon({ props: { name: "arrow-right" } }));
    await waitFor(() => {
      expect(view.container.querySelector("path")?.getAttribute("d")).toBe(
        "M5 12h14"
      );
    });
    view.unmount();
    const second = render(primitives.Icon({ props: { name: "arrow-right" } }));
    expect(second.container.querySelector("path")).not.toBeNull();
    expect(fetchIcon).toHaveBeenCalledOnce();
  });

  it("renders a scoped primitive style with responsive rules", () => {
    render(
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

  it("renders inline as a span", () => {
    render(
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
