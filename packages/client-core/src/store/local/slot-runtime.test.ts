import { allTasks } from "nanostores";
import { expect, it, vi } from "vite-plus/test";

import { createTailorKitFetchClient } from "#client/fetch-client";
import { createTailorKitStore } from "#store/store";
import { testContract } from "#test-contract";
import type { TailorKitApp } from "#types";

import { createSlotRuntime } from "./slot-runtime";
import type { SlotRuntimeOptions } from "./slot-runtime";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const setup = (multiple = false) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/api/",
    fetch,
  });
  const store = createTailorKitStore({
    apps: [],
    assetsBaseUrl: "https://assets.test/",
    baseUrl: client.baseUrl,
    client,
    contract: testContract(multiple),
  });
  const app: TailorKitApp = {
    currentDeployment: { id: "deployment" },
    id: "app",
    projectId: "project",
    views: [
      multiple
        ? { instances: true, path: "/", slot: "page" }
        : { path: "/", slot: "page" },
    ],
  };
  return { app, client, fetch, store };
};

it("waits for an active managed view and constructs deployment URL and hierarchy props in core", async () => {
  const { client, store, app, fetch } = setup();
  client.clear();
  const runtime = createSlotRuntime(store, {
    app,
    mode: "managed",
    slot: "page",
  });
  const stop = runtime.state.listen(
    vi.fn<NonNullable<Parameters<typeof runtime.state.listen>[0]>>()
  );
  expect(runtime.state.get().status).toBe("hidden");
  expect(fetch).not.toHaveBeenCalled();
  const id = Symbol("view");
  store.views.register({ context: { customer: "registered" }, id, view: "/" });
  await Promise.resolve();
  expect(runtime.state.get()).toMatchObject({
    appUrl:
      "https://assets.test/projects/project/apps/app/deployments/deployment/client/client.js",
    props: {
      declaredViews: ["/"],
      layers: [
        { context: { customer: "registered" }, path: "/", status: "ready" },
      ],
      slot: "page",
      supportedViews: ["/"],
      view: "/",
    },
    status: "render",
  });
  const stable = runtime.state.get();
  runtime.setInput({ app: { ...app }, mode: "managed", slot: "page" });
  expect(runtime.state.get()).toBe(stable);
  stop();
  store.views.unregister(id);
});

it("selects instances and validates keys without a framework", async () => {
  const { client, store, app } = setup(true);
  const instance = {
    data: { record: "customer" },
    key: "overview",
    metadata: { title: "Overview" },
  };
  const instances = vi
    .spyOn(client.endpoints, "slotInstances")
    .mockResolvedValue([instance]);
  const id = Symbol("view");
  store.views.register({ context: { customer: "registered" }, id, view: "/" });
  await Promise.resolve();
  const options: SlotRuntimeOptions = {
    app,
    instanceKey: "overview",
    mode: "managed",
    slot: "page",
  };
  const runtime = createSlotRuntime(store, options);
  const stop = runtime.state.listen(
    vi.fn<NonNullable<Parameters<typeof runtime.state.listen>[0]>>()
  );
  await allTasks();
  expect(runtime.state.get()).toMatchObject({
    props: { context: { customer: "registered" }, controlled: true, instance },
    status: "render",
  });
  runtime.setInput({ ...options, instanceKey: "missing" });
  expect(runtime.state.get()).toMatchObject({
    error: {
      message: 'View instance "missing" is unavailable.',
    },
    status: "error",
  });
  expect(instances).toHaveBeenCalledOnce();
  stop();
  store.views.unregister(id);
});

it("keeps controlled state independent and removes stale context and instances while loading", async () => {
  const { client, store, app } = setup(true);
  const options: SlotRuntimeOptions = {
    app,
    context: { supplied: true },
    instance: { data: {}, key: "one", metadata: {} },
    mode: "controlled",
    slot: "page",
    status: "ready",
    view: "/",
  };
  const runtime = createSlotRuntime(store, options);
  const instances = vi.spyOn(client.endpoints, "slotInstances");
  const stop = runtime.state.listen(
    vi.fn<NonNullable<Parameters<typeof runtime.state.listen>[0]>>()
  );
  const initial = runtime.state.get();
  const id = Symbol("other");
  store.views.register({ context: { unrelated: true }, id, view: "/" });
  await Promise.resolve();
  expect(runtime.state.get()).toBe(initial);
  runtime.setInput({ ...options, status: "loading" });
  const snapshot = runtime.state.get();
  expect(snapshot).toMatchObject({
    props: { context: undefined, status: "loading" },
    status: "render",
  });
  if (snapshot.status !== "render") {
    throw new Error("Expected render");
  }
  expect(snapshot.props).not.toHaveProperty("instance");
  runtime.setInput({ ...options, instance: undefined });
  expect(runtime.state.get()).toMatchObject({ status: "error" });
  expect(instances).not.toHaveBeenCalled();
  stop();
  store.views.unregister(id);
});

it("updates the session provider when deployment changes behind the same custom client URL", () => {
  const { store, app } = setup();
  const options: SlotRuntimeOptions = {
    app: { ...app, clientPath: "/client.js" },
    context: {},
    mode: "controlled",
    slot: "page",
    status: "ready",
    view: "/",
  };
  const runtime = createSlotRuntime(store, options);
  const initial = runtime.state.get();
  runtime.setInput({
    ...options,
    app: { ...options.app, currentDeployment: { id: "new" } },
  });
  const updated = runtime.state.get();
  expect(updated).not.toBe(initial);
  if (initial.status !== "render" || updated.status !== "render") {
    throw new Error("Expected render");
  }
  expect(updated.appUrl).toBe(initial.appUrl);
  expect(updated.getBackendSession).not.toBe(initial.getBackendSession);
});

it("keeps preview subscriptions across context changes and switches sessions without accepting old source", async () => {
  const { atom, onStop } = await import("nanostores");
  const { store } = setup();
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const first = atom({ revision: 0, source: null as string | null });
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const second = atom({ revision: 0, source: null as string | null });
  const stopped = vi.fn<Parameters<typeof onStop>[1]>();
  onStop(first, stopped);
  vi.spyOn(store.previews, "getStore").mockImplementation((getApp) =>
    getApp().preview?.sessionId === "first" ? first : second
  );
  const app: TailorKitApp = {
    id: "preview",
    preview: {
      expiresAt: "later",
      sessionId: "first",
      token: "token",
      websocketUrl: "wss://preview.test",
    },
  };
  const options: SlotRuntimeOptions = {
    app,
    context: { customer: "first" },
    mode: "controlled",
    slot: "page",
    status: "ready",
    view: "/",
  };
  const runtime = createSlotRuntime(store, options);
  const stop = runtime.state.listen(
    vi.fn<NonNullable<Parameters<typeof runtime.state.listen>[0]>>()
  );
  expect(runtime.state.get().status).toBe("hidden");
  stopped.mockClear();
  first.set({ revision: 1, source: "export default 1" });
  expect(runtime.state.get()).toMatchObject({
    appUrl: "https://host.test/api/preview/first/client.js",
    hostKey: 1,
    sourceText: "export default 1",
    status: "render",
  });
  runtime.setInput({ ...options, context: { customer: "second" } });
  expect(stopped).not.toHaveBeenCalled();
  expect(first.lc).toBe(1);
  runtime.setInput({
    ...options,
    app: {
      ...app,
      preview: { ...require(app.preview), sessionId: "second" },
    },
  });
  expect(stopped).toHaveBeenCalledOnce();
  const switched = runtime.state.get();
  expect(switched.status).toBe("hidden");
  first.set({ revision: 2, source: "stale" });
  expect(runtime.state.get()).toBe(switched);
  second.set({ revision: 3, source: "export default 3" });
  expect(runtime.state.get()).toMatchObject({
    appUrl: "https://host.test/api/preview/second/client.js",
    hostKey: 3,
    sourceText: "export default 3",
    status: "render",
  });
  stop();
  expect(second.lc).toBe(0);
});

it("cancels an instance request when switching to a controlled slot", async () => {
  const { client, store, app } = setup(true);
  let signal: AbortSignal | undefined;
  let respond!: (instances: []) => void;
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation(
    async (_app, _input, abort) => {
      signal = abort;
      return await (async () => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<
          Awaited<ReturnType<typeof client.endpoints.slotInstances>>
        >();
        try {
          respond = resolve;
        } catch (error) {
          rejectPending(error);
        }
        return await pendingPromise;
      })();
    }
  );
  const id = Symbol("view");
  store.views.register({ context: {}, id, view: "/" });
  await Promise.resolve();
  const runtime = createSlotRuntime(store, {
    app,
    instanceKey: "one",
    mode: "managed",
    slot: "page",
  });
  const stop = runtime.state.listen(
    vi.fn<NonNullable<Parameters<typeof runtime.state.listen>[0]>>()
  );
  await vi.waitFor(() => {
    expect(signal).toBeDefined();
  });
  runtime.setInput({
    app,
    context: {},
    instance: { data: {}, key: "two", metadata: {} },
    mode: "controlled",
    slot: "page",
    status: "ready",
    view: "/",
  });
  expect(signal?.aborted).toBe(true);
  const controlled = runtime.state.get();
  expect(controlled).toMatchObject({
    props: { instance: { key: "two" } },
    status: "render",
  });
  respond([]);
  await allTasks();
  expect(runtime.state.get()).toBe(controlled);
  stop();
  store.views.unregister(id);
});
