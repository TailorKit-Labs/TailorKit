// @vitest-environment happy-dom
import { h, render } from "preact";
import type { ComponentType, VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vite-plus/test";

import type { ShellProps } from "./routing";

vi.stubGlobal("__PREACT_VERSION__", "11.0.0");
const { createFileClient, defineRoute, Route } = await import("./routing");
const { defineView } = await import("./views");

it("keeps app and slot shells and common layouts mounted, and isolates mounted slots", async () => {
  const mounts = vi.fn();
  const cleanup = vi.fn();
  function Root({ children }: ShellProps) {
    useLayoutEffect(() => {
      mounts("root");
      return () => cleanup("root");
    }, []);
    return h("section", {}, children);
  }
  function SlotRoot() {
    useLayoutEffect(() => {
      mounts("slot");
      return () => cleanup("slot");
    }, []);
    return h("main", {}, h(Route, {}));
  }
  function Layout() {
    const [count, setCount] = useState(0);
    useLayoutEffect(() => {
      mounts("layout");
      return () => cleanup("layout");
    }, []);
    return h(
      "div",
      {},
      h("button", { onClick: () => setCount(count + 1) }, `count:${count}`),
      h(Route, {})
    );
  }
  const first = defineView({
    component: () => "first",
    slot: "panel",
    view: "/",
  });
  const users = defineView({
    component: () => "users",
    slot: "panel",
    view: "/users",
  });
  const client = createFileClient({
    layouts: [
      { slot: "panel", path: "/", filename: "layout.tsx", definition: Layout },
    ],
    root: {
      definition: defineRoute({ shellComponent: Root }),
      filename: "src/root.tsx",
    },
    roots: [
      {
        slot: "panel",
        filename: "src/slots/panel/root.tsx",
        definition: defineRoute({ shellComponent: SlotRoot }),
      },
    ],
    views: [
      { slot: "panel", filename: "home.view.tsx", definition: first },
      { slot: "panel", filename: "users.view.tsx", definition: users },
    ],
  });
  const container = document.createElement("div");
  const other = document.createElement("div");
  const show = (view: "/" | "/users", target = container) =>
    act(() => {
      const definition = client.slots.panel?.[view];
      if (!definition) {
        throw new Error("Missing view");
      }
      client.$runtime.render(
        h(definition.component as ComponentType<Record<string, unknown>>, {
          context: { userId: "u1", workspaceId: "w1" },
          status: "ready",
          view,
        }) as VNode,
        target
      );
    });
  try {
    await show("/");
    await act(() => container.querySelector("button")?.click());
    await show("/users");
    expect(container.textContent).toBe("count:1users");
    expect(mounts.mock.calls.map(([name]) => name).toSorted()).toEqual([
      "layout",
      "root",
      "slot",
    ]);
    expect(cleanup).not.toHaveBeenCalled();
    await show("/users", other);
    expect(other.textContent).toBe("count:0users");
    await act(() => client.$runtime.render(null, container));
    expect(cleanup.mock.calls.map(([name]) => name).toSorted()).toEqual([
      "layout",
      "root",
      "slot",
    ]);
  } finally {
    await act(() => {
      render(null, container);
      render(null, other);
    });
  }
});

it("matches layout prefixes at route boundaries and uses explicit view overrides", async () => {
  const view = defineView({
    component: () => h("div", {}, "leaf", h(Route, {})),
    slot: "panel",
    view: "/users",
  });
  const client = createFileClient({
    layouts: [
      {
        slot: "panel",
        path: "/users",
        filename: "users.layout.tsx",
        definition: ({ children }: ShellProps) =>
          h("div", {}, "users:", children),
      },
      {
        slot: "panel",
        path: "/",
        filename: "layout.tsx",
        definition: ({ children }: ShellProps) =>
          h("div", {}, "all:", children),
      },
      {
        slot: "panel",
        path: "/user",
        filename: "user.layout.tsx",
        definition: () => "wrong",
      },
    ],
    roots: [],
    views: [
      {
        slot: "panel",
        filename: "descriptive-name.view.tsx",
        definition: view,
      },
    ],
  });
  const container = document.createElement("div");
  try {
    const definition = client.slots.panel?.["/users"];
    if (!definition) {
      throw new Error("Missing view");
    }
    await act(() =>
      client.$runtime.render(
        h(definition.component, {
          context: { userId: "u1", workspaceId: "w1" },
          status: "ready",
          view: "/users",
        }) as VNode,
        container
      )
    );
    expect(container.textContent).toBe("all:users:leaf");
  } finally {
    await act(() => client.$runtime.render(null, container));
  }
});

it("rejects duplicate paths, invalid root exports, and incorrect slots", () => {
  const view = defineView({ component: () => null, slot: "panel", view: "/" });
  const module = { definition: view, filename: "home.view.tsx", slot: "panel" };
  const options = { layouts: [], roots: [], views: [module] };
  expect(() =>
    createFileClient({
      ...options,
      views: [...options.views, ...options.views],
    })
  ).toThrow("Duplicate view");
  expect(() =>
    createFileClient({
      ...options,
      root: { definition: () => null, filename: "root.tsx" },
    })
  ).toThrow("defineRoute");
  expect(() =>
    createFileClient({ ...options, views: [{ ...module, slot: "navbar" }] })
  ).toThrow('declares slot "panel"');
  expect(() =>
    createFileClient({
      ...options,
      views: [{ ...module, definition: () => null }],
    })
  ).toThrow("defineView");
});
