// @vitest-environment happy-dom
import { createRemoteUiStore } from "@patchsmith/sandbox/host";
import type {
  IframeUiHost,
  IframeUiHostOptions,
} from "@patchsmith/sandbox/host";
import type { RemoteElementNode } from "@patchsmith/sandbox/protocol";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { createRemoteElementProps, createRemoteViewStore } from "./remote-view";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const tree: RemoteElementNode = {
  callbacks: [{ callback: "onSelect", event: "selected", inputCount: 1 }],
  children: [],
  id: "root",
  kind: "element",
  props: { label: "Button" },
  type: "Button",
};

const isCallback = <TValue>(
  value: TValue
): value is TValue & ((...args: unknown[]) => void) =>
  typeof value === "function";

const setup = () => {
  const records: {
    host: IframeUiHost;
    options: IframeUiHostOptions;
    listeners: (() => void)[];
  }[] = [];
  const createHost = vi.fn(
    (_url: string | URL, options: IframeUiHostOptions = {}) => {
      const source = createRemoteUiStore();
      const listeners: (() => void)[] = [];
      const host: IframeUiHost = {
        ...source,

        destroy: vi.fn<IframeUiHost["destroy"]>(),

        dispatch: vi.fn<IframeUiHost["dispatch"]>(),
        iframe: document.createElement("iframe"),

        mount: vi.fn<IframeUiHost["mount"]>(),

        setProps: vi.fn<IframeUiHost["setProps"]>(),
        subscribe: vi.fn(
          (listener: Parameters<IframeUiHost["subscribe"]>[0]) => {
            listeners.push(listener);
            return source.subscribe(listener);
          }
        ),
      };
      records.push({ host, listeners, options });
      return host;
    }
  );
  return { createHost, records };
};
afterEach(() => vi.restoreAllMocks());

it("publishes host status and native node selectors together without a rendering framework", () => {
  const { createHost, records } = setup();
  const store = createRemoteViewStore({}, createHost);
  expect(store.state.get()).toEqual({
    error: null,
    generation: 0,
    status: "starting",
  });
  const stop = store.mount({ appUrl: "https://host.test/app.js" });
  const listener = vi.fn(() => ({
    root: store.nodes.root.get(),
    status: store.state.get().status,
  }));

  const stopRoot = store.nodes.root.listen(() => {
    listener();
  });
  requireValue(records[0]).host.setSnapshot(tree, 1);
  expect(listener).toHaveLastReturnedWith({ root: "root", status: "ready" });
  expect(store.nodes.selectNode("root").get()).toEqual(tree);
  const ready = store.state.get();
  requireValue(records[0]).host.setSnapshot(
    { ...tree, props: { label: "Updated" } },
    2
  );
  expect(store.state.get()).toBe(ready);
  stopRoot();
  stop();
  expect(store.nodes.root.get()).toBeNull();
  expect(requireValue(records[0]).host.destroy).toHaveBeenCalledOnce();
});

const secondImplementation = () => "second";

const firstImplementation = () => "first";

it("updates only changed component selectors without recreating the host", () => {
  const { createHost, records } = setup();
  const first = firstImplementation;
  const second = secondImplementation;
  const store = createRemoteViewStore(
    { components: { Button: first } },
    createHost
  );
  const stop = store.mount({ appUrl: "https://host.test/app.js" });
  requireValue(records[0]).host.setSnapshot(tree, 1);
  const snapshot = store.nodes.state.get();
  const component = store.selectComponent("Button");
  const listener = vi.fn<Parameters<typeof component.listen>[0]>();
  const stopComponent = component.listen(listener);
  store.setComponents({ Button: first, Input: () => null });
  expect(listener).not.toHaveBeenCalled();
  store.setComponents({ Button: second });
  expect(component.get()).toBe(second);
  expect(listener).toHaveBeenCalledOnce();
  expect(createHost).toHaveBeenCalledOnce();
  expect(store.nodes.state.get()).toBe(snapshot);
  stopComponent();
  stop();
});

it("retains the latest props and shares callback payload construction", () => {
  const { createHost, records } = setup();
  const store = createRemoteViewStore({ props: { value: "old" } }, createHost);
  const latest = { value: "latest" };
  store.setProps(latest);
  const stop = store.mount({
    appUrl: "https://host.test/app.js",
  });
  expect(requireValue(records[0]).options).toMatchObject({
    props: latest,
  });
  store.setProps(undefined);
  expect(requireValue(records[0]).host.setProps).toHaveBeenCalledWith(
    undefined
  );
  const props = createRemoteElementProps(tree, store.dispatch);
  const { onSelect } = props;
  if (!isCallback(onSelect)) {
    throw new Error("Expected an onSelect callback.");
  }
  onSelect("selected value", {
    synthetic: "event",
  });
  expect(
    requireValue(records[0]).host.dispatch
  ).toHaveBeenCalledExactlyOnceWith({
    data: { args: ["selected value"], event: "selected", nodeId: "root" },
    type: "dispatchCallback",
  });
  expect(tree.props).toEqual({ label: "Button" });
  stop();
  onSelect("after stop");
  expect(requireValue(records[0]).host.dispatch).toHaveBeenCalledOnce();
});

it("isolates dispatch, component registries, and trees between remote views", () => {
  const { createHost, records } = setup();
  const first = createRemoteViewStore(
    { components: { Button: "first" } },
    createHost
  );
  const second = createRemoteViewStore(
    { components: { Button: "second" } },
    createHost
  );
  const stopFirst = first.mount({ appUrl: "https://host.test/first.js" });
  const stopSecond = second.mount({ appUrl: "https://host.test/second.js" });
  requireValue(records[0]).host.setSnapshot(tree, 1);
  expect(second.nodes.root.get()).toBeNull();
  const operation = createRemoteElementProps(tree, second.dispatch).onSelect;
  if (!isCallback(operation)) {
    throw new Error("Expected an onSelect callback.");
  }
  operation("second");
  expect(requireValue(records[0]).host.dispatch).not.toHaveBeenCalled();
  expect(requireValue(records[1]).host.dispatch).toHaveBeenCalledOnce();
  expect(first.components.get()).toEqual({ Button: "first" });
  expect(second.components.get()).toEqual({ Button: "second" });
  stopFirst();
  stopSecond();
});

it("ignores stale host events and cleanup after a replacement mount", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { createHost, records } = setup();
  const store = createRemoteViewStore({}, createHost);
  const stopFirst = store.mount({ appUrl: "https://host.test/first.js" });
  requireValue(records[0]).host.setSnapshot(tree, 1);
  const stopSecond = store.mount({ appUrl: "https://host.test/second.js" });
  expect(requireValue(records[0]).host.destroy).toHaveBeenCalledOnce();
  expect(store.nodes.root.get()).toBeNull();
  requireValue(requireValue(records[0]).listeners[0])();
  requireValue(requireValue(records[0]).options.onError)(
    new Error("Stale failure")
  );
  stopFirst();
  expect(err).not.toHaveBeenCalled();
  expect(store.state.get().status).toBe("starting");
  expect(requireValue(records[1]).host.destroy).not.toHaveBeenCalled();
  requireValue(records[1]).host.setSnapshot(tree, 1);
  expect(store.state.get()).toMatchObject({ generation: 2, status: "ready" });
  stopSecond();
  stopSecond();
  expect(requireValue(records[1]).host.destroy).toHaveBeenCalledOnce();
});

it("reports startup failures, releases partial hosts, and recovers on the next mount", () => {
  const err2 = vi.spyOn(console, "error").mockImplementation(() => {});
  const { createHost, records } = setup();
  const failure = new Error("Failed to start");
  createHost.mockImplementationOnce((_url, options = {}) => {
    const source = createRemoteUiStore();
    const host: IframeUiHost = {
      ...source,

      destroy: vi.fn<IframeUiHost["destroy"]>(),

      dispatch: vi.fn<IframeUiHost["dispatch"]>(),
      iframe: document.createElement("iframe"),
      mount: () => {
        throw failure;
      },

      setProps: vi.fn<IframeUiHost["setProps"]>(),
    };
    records.push({ host, listeners: [], options });
    return host;
  });
  const store = createRemoteViewStore({}, createHost);
  store.mount({ appUrl: "https://host.test/first.js" });
  expect(store.state.get()).toMatchObject({ error: failure, status: "error" });
  expect(err2).toHaveBeenCalledExactlyOnceWith(
    "PatchSmith remote app failed",
    failure
  );
  expect(requireValue(records[0]).host.destroy).toHaveBeenCalledOnce();
  const stop = store.mount({ appUrl: "https://host.test/second.js" });
  requireValue(records[1]).host.setSnapshot(tree, 1);
  expect(store.state.get()).toMatchObject({ error: null, status: "ready" });
  stop();
});
