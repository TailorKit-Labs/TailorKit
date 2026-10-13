import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createViewContextStore } from "./view-context";

const createStore = () =>
  createViewContextStore({
    views: {
      "/first": z.looseObject({}),
      "/home": z.looseObject({}),
      "/home/detail": z.looseObject({}),
      "/last": z.looseObject({}),
    },
  });

describe("view context store", () => {
  it("publishes nested view registration once after synchronous updates settle", async () => {
    const registry = createStore();
    const parent = Symbol("parent");
    const child = Symbol("child");
    const listener = vi.fn<Parameters<typeof registry.subscribe>[0]>();
    const stop = registry.subscribe(listener);
    registry.register({ context: { parent: true }, id: parent, view: "/home" });
    registry.register({
      context: { child: true },
      id: child,
      loading: true,
      view: "/home/detail",
    });
    expect(registry.getSnapshot()).toBeNull();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(registry.getSnapshot()).toEqual({
      layers: [
        { context: { parent: true }, path: "/home", status: "ready" },
        { context: undefined, path: "/home/detail", status: "loading" },
      ],
      view: "/home/detail",
    });
    expect(registry.state.get()).toBe(registry.getSnapshot());
    registry.unregister(child);
    await Promise.resolve();
    expect(registry.getSnapshot()?.view).toBe("/home");
    registry.unregister(parent);
    await Promise.resolve();
    expect(registry.getSnapshot()).toBeNull();
    stop();
  });

  it("preserves mount order when entries update and isolates registries", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = createStore();
      const other = createStore();
      const first = Symbol("first");
      const last = Symbol("last");
      registry.register({ context: {}, id: first, view: "/first" });
      registry.register({ context: {}, id: last, view: "/last" });
      registry.register({
        context: { updated: true },
        id: first,
        view: "/first",
      });
      await Promise.resolve();
      expect(registry.getSnapshot()?.view).toBe("/last");
      expect(warning).toHaveBeenCalledOnce();
      expect(other.getSnapshot()).toBeNull();
    } finally {
      warning.mockRestore();
    }
  });
});
