// @vitest-environment happy-dom
import { h, render } from "preact";
import type { ComponentChild } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.stubGlobal("__PREACT_VERSION__", "11.0.0");
const { defineView } = await import("./views");
const roots: HTMLElement[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    render(null, root);
  }
});

const root = () => {
  const element = document.createElement("div");
  roots.push(element);
  return element;
};

it("supplies instance data and context, updates data, and resets component state when the key changes", async () => {
  // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.
  const view = defineView({
    // oxlint-disable-next-line func-name-matching -- The named function is a React-compatible test component supplied through a component property.
    component: function ViewComponent(): ComponentChild {
      const instance = view.useInstance();
      const context = view.useContext();
      // oxlint-disable-next-line react/hook-use-state -- The test reads the initial state without exposing a setter.
      const [initialKey] = useState(instance.key);
      return h(
        "span",
        {},
        `${context.workspaceId}:${instance.key}:${JSON.stringify(instance.data)}:${initialKey}`
      );
    },
    instances: { resolver: "compiled-resolver" } as never,
    slot: "page",
    view: "/",
  });
  const container = root();
  const show = <TData>(key: string, data: TData) =>
    act(() =>
      render(
        h(view.component, {
          context: { workspaceId: "u1" },
          instance: { data, key, metadata: {} },
          status: "ready",
          view: "/",
        }),
        container
      )
    );
  await show("overview", { count: 1 });
  expect(container.textContent).toBe('u1:overview:{"count":1}:overview');
  await show("overview", { count: 2 });
  expect(container.textContent).toBe('u1:overview:{"count":2}:overview');
  await show("summary", null);
  expect(container.textContent).toBe("u1:summary:null:summary");
  await act(() =>
    render(h(view.component, { status: "loading", view: "/" }), container)
  );
  expect(container.textContent).toBe("");
  await show("summary", { count: 3 });
  expect(container.textContent).toBe('u1:summary:{"count":3}:summary');
});

it("keeps ordinary views rendering without an instance", async () => {
  const view = defineView({
    component: () => "ordinary",
    slot: "navbar",
    view: "/",
  });
  const container = root();
  await act(() =>
    render(
      h(view.component, {
        context: { workspaceId: "w1" },
        status: "ready",
        view: "/",
      }),
      container
    )
  );
  expect(container.textContent).toBe("ordinary");
});

it("reports missing instances and useInstance outside its view", () => {
  // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.
  const view = defineView({
    component: () => "never",
    instances: { resolver: "compiled-resolver" } as never,
    slot: "page",
    view: "/",
  });
  expect(() =>
    render(
      h(view.component, {
        context: { workspaceId: "w1" },
        status: "ready",
        view: "/",
      }),
      root()
    )
  ).toThrow("requires a selected instance");
  const Outside = () => {
    view.useInstance();
    return null;
  };
  expect(() => render(h(Outside, {}), root())).toThrow(
    "View instance is only available"
  );
});
