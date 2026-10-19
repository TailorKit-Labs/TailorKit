import { createRemoteElementProps } from "@tailorkit/client-core";
import type { PrimitiveProps } from "@tailorkit/client-core";
import type { HostToIframePayload } from "@tailorkit/sandbox/protocol";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";

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

afterEach(cleanup);

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

const ThemedPressable = ({
  props,
  children = "Project",
}: {
  props: PrimitiveProps;
  children?: ReactNode;
}) => (
  <PrimitiveThemeContext.Provider value={contextValue1}>
    <primitives.Pressable props={props}>{children}</primitives.Pressable>
  </PrimitiveThemeContext.Provider>
);

const renderPressable = (overrides: PrimitiveProps = {}) => {
  const events: HostToIframePayload[] = [];
  const props = createRemoteElementProps(
    {
      callbacks: [{ callback: "onPress", event: "press", inputCount: 0 }],
      children: [],
      id: "pressable",
      kind: "element",
      props: overrides,
      type: "Pressable",
    },
    async (event) => {
      events.push(event);
      await Promise.resolve();
    }
  );
  const rendered = render(<ThemedPressable props={props} />);
  const button = screen.getByRole("button");
  return { ...rendered, button, events, props };
};

describe("Pressable", () => {
  it.each([
    [undefined, "inline-flex"],
    ["inline", "inline-flex"],
    ["box", "block"],
    ["flex", "flex"],
    ["grid", "grid"],
  ])("owns a div with layout %s mapped to %s", (layout, display) => {
    const { button, container } = renderPressable({ layout, padding: "md" });
    expect(button.tagName).toBe("DIV");
    expect(button.tabIndex).toBe(0);
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(container.querySelector("style")?.textContent).toContain(
      `display: ${display};`
    );
    expect(container.querySelector("style")?.textContent).toContain(
      "padding: var(--tailorkit-space-md);"
    );
    // Styles stay outside the accessible name.
    expect(button.querySelector("style")).toBeNull();
    expect(screen.getByRole("button", { name: "Project" })).toBe(button);
  });

  it("supports nested layout children and an explicit icon-only name", () => {
    const { button, rerender, props } = renderPressable({ layout: "flex" });
    rerender(
      <ThemedPressable props={props}>
        {primitives.Box({
          children: primitives.Inline({ children: "Subject", props: {} }),
          props: { grow: "1" },
        })}
      </ThemedPressable>
    );
    expect(screen.getByRole("button", { name: "Subject" })).toBe(button);
    fireEvent.click(screen.getByText("Subject"));
    rerender(
      <ThemedPressable props={{ ...props, ariaLabel: "Open email" }}>
        <span aria-hidden="true">→</span>
      </ThemedPressable>
    );
    expect(screen.getByRole("button", { name: "Open email" })).toBe(button);
  });

  it("dispatches one zero-argument sandbox callback per click", () => {
    const { button, events } = renderPressable();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.click(button, { detail: 1 });
    const [callback] = events;
    const callbackId =
      callback?.type === "dispatchCallback" ? callback.data.id : undefined;
    expect(callbackId).toEqual(expect.any(String));
    expect(events).toEqual([
      {
        data: {
          args: [],
          event: "press",
          id: callbackId,
          nodeId: "pressable",
        },
        type: "dispatchCallback",
      },
    ]);
    // Programmatic and assistive-technology clicks work without pointer events.
    act(() => {
      button.click();
    });
    expect(events).toHaveLength(2);
    fireEvent.click(button, { button: 2 });
    expect(events).toHaveLength(2);
  });

  it("activates Enter on keydown once and shows pressed styling until keyup", () => {
    const { button, events } = renderPressable();
    act(() => {
      button.focus();
    });
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(false);
    expect(events).toHaveLength(1);
    expect(button.dataset.pressed).toBe("");
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    expect(events).toHaveLength(1);
    fireEvent.keyUp(button, { key: "Enter" });
    expect(events).toHaveLength(1);
    expect(button.dataset.pressed).toBeUndefined();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(events).toHaveLength(2);
  });

  it("prevents Space scrolling and activates once on keyup", () => {
    const { button, events } = renderPressable();
    act(() => {
      button.focus();
    });
    expect(fireEvent.keyDown(button, { key: " " })).toBe(false);
    expect(events).toHaveLength(0);
    expect(button.dataset.pressed).toBe("");
    fireEvent.keyDown(button, { key: " ", repeat: true });
    expect(fireEvent.keyUp(button, { key: " " })).toBe(false);
    expect(events).toHaveLength(1);
    expect(button.dataset.pressed).toBeUndefined();
    expect(document.activeElement).toBe(button);
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(1);
    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(2);
  });

  it("cancels a held Space on blur, even after refocusing", () => {
    const { button, events } = renderPressable();
    act(() => {
      button.focus();
    });
    fireEvent.keyDown(button, { key: " " });
    act(() => {
      button.blur();
    });
    expect(button.dataset.pressed).toBeUndefined();
    act(() => {
      button.focus();
    });
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(0);
  });

  it("cancels a held Space when disabled, even after re-enabling", () => {
    const { button, events, props, rerender } = renderPressable();
    fireEvent.keyDown(button, { key: " " });
    rerender(<ThemedPressable props={{ ...props, disabled: true }} />);
    expect(button.dataset.pressed).toBeUndefined();
    rerender(<ThemedPressable props={props} />);
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(0);
  });

  it("announces disabled, leaves the tab order, and blocks all activations", () => {
    const { button, events } = renderPressable({ disabled: true });
    expect(screen.getByRole("button", { name: "Project" })).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.tabIndex).toBe(-1);
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.pointerDown(button, { button: 0 });
    expect(document.activeElement).not.toBe(button);
    expect(fireEvent.click(button)).toBe(false);
    act(() => {
      button.click();
    });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyUp(button, { key: "Enter" });
    expect(fireEvent.keyDown(button, { key: " " })).toBe(false);
    expect(fireEvent.keyUp(button, { key: " " })).toBe(false);
    expect(events).toHaveLength(0);
    expect(button.dataset.pressed).toBeUndefined();
  });

  it("preserves focus moved intentionally by the action", () => {
    const { button, props, rerender } = renderPressable();
    const input = document.createElement("input");
    document.body.append(input);
    rerender(
      <ThemedPressable
        props={{
          ...props,
          onPress: () => {
            input.focus();
          },
        }}
      />
    );
    act(() => {
      button.focus();
    });
    fireEvent.keyDown(button, { key: "Enter" });
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("ignores unrelated keys and supports missing callbacks", () => {
    const { button, events, rerender } = renderPressable();
    expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
    fireEvent.keyDown(button, { key: "Escape" });
    fireEvent.keyUp(button, { key: "Escape" });
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(0);
    rerender(<ThemedPressable props={{}} />);
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyUp(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    expect(events).toHaveLength(0);
  });
});
