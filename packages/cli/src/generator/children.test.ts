import { createRemoteComponent } from "@patchsmith/app";
import { describe, expect, it, vi } from "vite-plus/test";

import { renderGeneratedTypes } from "./types";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isCallback = <TValue>(
  value: TValue
): value is TValue &
  ((event: {
    detail: unknown[];
    respondWith: (operation: () => void) => void;
  }) => void) => typeof value === "function";

describe("children-only components", () => {
  it("generates opt-in children and leaf component bindings", () => {
    const output = renderGeneratedTypes({
      components: {
        Card: { callbacks: {}, children: true },
        Image: { callbacks: {}, children: false },
        Input: { callbacks: {}, children: false },
      },
      views: {},
    });

    expect(output).toContain(
      'createRemoteComponent<CardProps, true>("Card", {\n  children: true,'
    );
    expect(output).toContain(
      'createRemoteComponent<InputProps, false>("Input", {\n  children: false,'
    );
    expect(output).toContain(
      'createRemoteComponent<ImageProps, false>("Image", {\n  children: false,'
    );
  });

  it("rejects components without a serialized children value", () => {
    expect(() =>
      renderGeneratedTypes({
        components: {
          Input: { callbacks: {} },
        },
        views: {},
      })
    ).toThrow();
  });

  it("preserves multiple children and nested remote components", () => {
    const Card = createRemoteComponent<object, true>("Card", {
      children: true,
    });

    const nested = Card({ children: "nested" });
    const children = ["first", 0, nested];
    const node = Card({ children });
    expect(node).toMatchObject({
      props: { children },
      type: "patchsmith-card",
    });
  });

  it("preserves callback dispatch alongside children", () => {
    const onClick = vi.fn<() => void>();

    const Button = createRemoteComponent<{ onClick: () => void }, true>(
      "Button",
      {
        callbacks: { onClick: 0 },
        children: true,
      }
    );

    const node = Button({ children: "Save", onClick });
    expect(node).toMatchObject({
      props: { children: "Save" },
      type: "patchsmith-button",
    });

    if (!isObjectValue(node) || !("props" in node)) {
      throw new Error("Expected a remote component node");
    }

    const props: unknown = node.props;

    if (
      !isObjectValue(props) ||
      !("onpatchsmithcallbackonclick" in props) ||
      !isCallback(props.onpatchsmithcallbackonclick)
    ) {
      throw new Error("Expected an onClick callback.");
    }

    props.onpatchsmithcallbackonclick({
      detail: [],
      respondWith: (operation) => {
        operation();
      },
    });
    expect(onClick).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not forward children supplied to leaf components at runtime", () => {
    const Leaf = createRemoteComponent<object>("Leaf");
    // @ts-expect-error exercise untyped callers that bypass the generated contract
    const node = Leaf({ children: "not allowed" });
    expect(node).toMatchObject({
      props: { children: undefined },
      type: "patchsmith-leaf",
    });
  });
});
