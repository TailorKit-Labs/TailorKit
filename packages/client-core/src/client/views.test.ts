import { expect, it, vi } from "vite-plus/test";

import { createSlotStore } from "#store/fetch/slot";
import { createPatchsmithStore } from "#store/store";
import { testContract } from "#test-contract";

import { createPatchsmithFetchClient } from "./fetch-client";
import { refetchViews } from "./views";

const deferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = (async () => {
    const {
      promise: pendingPromise,
      resolve: done,
      reject: rejectPending,
    } = Promise.withResolvers<Response>();
    try {
      resolve = done;
    } catch (error) {
      rejectPending(error);
    }
    return await pendingPromise;
  })();
  return { promise, resolve };
};

it("joins discovery and resolves single slots from the imported contract without metadata", async () => {
  const discovery = deferredResponse();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => await discovery.promise
  );
  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test",
    fetch,
  });
  const contract = testContract();
  const store = createPatchsmithStore({
    baseUrl: client.baseUrl,
    client,
    contract,
  });
  const app = { id: "app", views: [{ path: "/", slot: "page" }] };
  const pending = refetchViews(store, { slot: "page" });
  discovery.resolve(Response.json([app]));
  await pending;
  const result = createSlotStore(client, contract, {
    activeView: null,
    apps: [app],
    slot: "page",
  });
  expect(result.getSnapshot()).toMatchObject({
    data: [{ app }],
    status: "ready",
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL("https://host.test/apps"),
    expect.anything()
  );
});

it("refreshes instances using the current registered context without refreshing discovery", async () => {
  const instanceFetch = vi
    .fn<
      ReturnType<
        typeof createPatchsmithFetchClient
      >["endpoints"]["slotInstances"]
    >()
    .mockResolvedValue([{ data: {}, key: "overview", metadata: {} }]);
  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test",
    fetch: vi.fn(),
  });
  const app = {
    id: "app",
    views: [{ instances: true as const, path: "/", slot: "page" }],
  };
  const store = createPatchsmithStore({
    apps: [app],
    baseUrl: client.baseUrl,
    client,
    contract: testContract(true),
  });
  const apps = vi.spyOn(store, "fetchApps");
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation(instanceFetch);
  const id = Symbol("view");
  store.views.register({ context: { customer: "first" }, id, view: "/" });
  await Promise.resolve();
  await refetchViews(store, { slot: "page" });
  store.views.register({ context: { customer: "second" }, id, view: "/" });
  await Promise.resolve();
  await refetchViews(store, { slot: "page" });
  expect(instanceFetch.mock.calls.map(([, input]) => input.context)).toEqual([
    { customer: "first" },
    { customer: "second" },
  ]);
  expect(apps).not.toHaveBeenCalled();
  store.views.unregister(id);
  await Promise.resolve();
});
