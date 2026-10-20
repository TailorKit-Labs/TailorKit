// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";

import { readElementProps } from "./serialize.js";

describe("readElementProps", () => {
  it.each(["textColor", "textcolor"])(
    "canonicalizes the %s DOM attribute to textColor",
    (name) => {
      const element = document.createElement("patchsmith-box");
      element.setAttribute(name, "muted");

      expect(readElementProps(element)).toEqual({ textColor: "muted" });
    }
  );

  it("preserves typed props and their declared names", () => {
    const element = document.createElement("patchsmith-card");
    element.dataset.patchsmithProps = JSON.stringify({
      count: 3,
      enabled: false,
      metadata: { owner: "Patchsmith" },
      textColor: "default",
    });
    element.dataset.patchsmithCallbacks = "{}";

    expect(readElementProps(element)).toEqual({
      count: 3,
      enabled: false,
      metadata: { owner: "Patchsmith" },
      textColor: "default",
    });
  });

  it("excludes internal protocol attributes from the fallback props", () => {
    const element = document.createElement("patchsmith-button");
    element.dataset.patchsmithCallbacks = "{}";
    element.dataset.patchsmithProps = "invalid JSON";
    element.setAttribute("disabled", "false");

    expect(readElementProps(element)).toEqual({ disabled: "false" });
  });
});
