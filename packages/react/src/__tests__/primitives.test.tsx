import { createRemoteElementProps } from "@tailorkit/client-core";
import type { HostToIframePayload } from "@tailorkit/sandbox/protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";

import { PrimitiveThemeContext, primitives } from "#primitives";

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

const contextValue1 = { theme, viewId: "screen-1" };
const contextValue2 = { theme, viewId: "screen-2" };

describe("react primitives", () => {
  it("renders a scoped primitive style with responsive rules", () => {
    render(
      <PrimitiveThemeContext.Provider value={contextValue1}>
        {primitives.Flex({
          children: createElement("span", null, "Content"),
          props: {
            border: "solid",
            direction: { default: "column", lg: "row" },
            gap: "md",
            padding: { default: "md", lg: "lg" },
            textColor: { default: "muted", lg: "foreground" },
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

describe("Pressable", () => {
  it("dispatches one zero-argument sandbox callback from a native button", () => {
    const events: HostToIframePayload[] = [];
    const props = createRemoteElementProps(
      {
        callbacks: [{ callback: "onPress", event: "press", inputCount: 0 }],
        children: [],
        id: "pressable",
        kind: "element",
        props: { ariaLabel: "Open project", layout: "box", padding: "md" },
        type: "Pressable",
      },
      (event) => {
        events.push(event);
      }
    );
    const { container, rerender } = render(
      <PrimitiveThemeContext.Provider value={contextValue1}>
        {primitives.Pressable({ children: "Project", props })}
      </PrimitiveThemeContext.Provider>
    );
    const button = screen.getByRole("button", { name: "Open project" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(container.querySelector("style")?.textContent).toContain(
      "display: block;"
    );
    // Styles stay outside the button's accessible name and content model.
    expect(button.querySelector("style")).toBeNull();
    fireEvent.click(button);
    expect(events).toEqual([
      {
        data: { args: [], event: "press", nodeId: "pressable" },
        type: "dispatchCallback",
      },
    ]);
    rerender(
      <PrimitiveThemeContext.Provider value={contextValue1}>
        {primitives.Pressable({
          children: "Project",
          props: { ...props, disabled: true },
        })}
      </PrimitiveThemeContext.Provider>
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(events).toHaveLength(1);
  });
});
