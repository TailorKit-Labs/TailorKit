import { allTasks } from "nanostores";
import { expect, it, vi } from "vite-plus/test";

import { createTailorKitFetchClient } from "../client/fetch-client";
import { testContract } from "../test-contract";
import type { TailorKitApp } from "../types";
import {
  createAppsQuery,
  createAppViewsQuery,
  createViewsQuery,
} from "./query";
import { createTailorKitStore } from "./store";

const setup = (multiple = true, apps?: TailorKitApp[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/api/",
    fetch,
  });
  const store = createTailorKitStore({
    apps,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(multiple),
  });
  const app: TailorKitApp = {
    id: "app",
    views: [
      multiple
        ? { instances: true, path: "/", slot: "page" }
        : { path: "/", slot: "page" },
    ],
  };
  return { app, client, fetch, store };
};

it("starts discovery only when observed and supplies filtered results and shared status flags", async () => {
  const { fetch, store } = setup();
  let resolve!: (response: Response) => void;
  fetch.mockImplementation(() =>
    (() => {
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
      return pendingPromise;
    })()
  );
  const query = createAppsQuery(store, {
    appIds: ["included"],
    scopes: ["user"],
  });
  expect(query.state.get()).toMatchObject({
    data: undefined,
    isLoading: false,
    isPending: true,
  });
  expect(fetch).not.toHaveBeenCalled();
  const stop = query.state.listen(vi.fn());
  expect(query.state.get()).toMatchObject({
    isFetching: true,
    isLoading: true,
    isPending: true,
  });
  await Promise.resolve();
  resolve(
    Response.json([
      {
        id: "included",
        scope: { context: {}, name: "user" },
      },
      {
        id: "excluded",
        scope: { context: {}, name: "user" },
      },
      {
        id: "other",
        scope: { context: {}, name: "organization" },
      },
    ])
  );
  await allTasks();
  expect(query.state.get()).toMatchObject({
    data: [{ id: "included" }],
    isError: false,
    isFetching: false,
    isSuccess: true,
  });
  store.setProvidedApps([]);
  expect(query.state.get().data).toEqual([]);
  await query.refetch();
  expect(fetch).toHaveBeenCalledOnce();
  stop();
});

it("updates single-slot results from provided apps without observing context or resolving instances", async () => {
  const { client, fetch, store, app } = setup(false, []);
  const instances = vi.spyOn(client.endpoints, "slotInstances");
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(vi.fn());
  await allTasks();
  expect(query.state.get().data).toEqual([]);
  store.setProvidedApps([app]);
  await allTasks();
  const ready = query.state.get();
  expect(ready.data).toEqual([{ app }]);
  const id = Symbol("view");
  store.views.register({ context: undefined, id, loading: true, view: "/" });
  await Promise.resolve();
  expect(query.state.get()).toBe(ready);
  expect(fetch).not.toHaveBeenCalled();
  expect(instances).not.toHaveBeenCalled();
  stop();
  store.views.unregister(id);
});

it("switches instance queries on context changes and immediately cancels unobserved requests", async () => {
  const { client, store, app } = setup(true, []);
  store.setProvidedApps([app]);
  const requests: {
    signal: AbortSignal;
    resolve: (
      value: {
        key: string;
        metadata: Record<string, never>;
        data: Record<string, never>;
      }[]
    ) => void;
  }[] = [];
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation(
    (_app, _input, signal) =>
      (() => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<
          {
            key: string;
            metadata: Record<string, never>;
            data: Record<string, never>;
          }[]
        >();
        try {
          requests.push({ resolve, signal });
        } catch (error) {
          rejectPending(error);
        }
        return pendingPromise;
      })()
  );
  const id = Symbol("view");
  store.views.register({ context: { customer: "first" }, id, view: "/" });
  await Promise.resolve();
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(vi.fn());
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  store.views.register({ context: { customer: "second" }, id, view: "/" });
  await Promise.resolve();
  expect(requests[0]?.signal.aborted).toBe(true);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(query.state.get().data).toBeUndefined();
  requests[1]?.resolve([
    {
      data: {},
      key: "second",
      metadata: {},
    },
  ]);
  await vi.waitFor(() =>
    expect(query.state.get().data?.[0]).toMatchObject({ app, key: "second" })
  );
  requests[0]?.resolve([
    {
      data: {},
      key: "late",
      metadata: {},
    },
  ]);
  await allTasks();
  expect(query.state.get().data?.[0]).toMatchObject({ key: "second" });
  const pending = query.refetch();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  stop();
  expect(requests[2]?.signal.aborted).toBe(true);
  requests[2]?.resolve([
    {
      data: {},
      key: "stopped",
      metadata: {},
    },
  ]);
  await pending;
  store.views.unregister(id);
});

it("refetches an unobserved explicit app with the latest registered context without discovery", async () => {
  const { client, fetch, store, app } = setup();
  const instances = vi
    .spyOn(client.endpoints, "slotInstances")
    .mockResolvedValue([]);
  const query = createAppViewsQuery(store, app, "page");
  const id = Symbol("view");
  store.views.register({ context: { customer: "latest" }, id, view: "/" });
  await Promise.resolve();
  await query.refetch();
  expect(instances).toHaveBeenCalledWith(
    app,
    expect.objectContaining({ context: { customer: "latest" } }),
    expect.any(AbortSignal)
  );
  expect(fetch).not.toHaveBeenCalled();
  store.views.unregister(id);
});

it("sends parsed native contract context to instance requests without calling metadata", async () => {
  const { defineContract } = await import("@tailorkit/core/schema");
  const { z } = await import("zod");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new Error("Unexpected HTTP request"));
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test",
    fetch,
  });
  const contract = defineContract({
    slots: { page: { multiple: true, views: ["/"] } },
    views: { "/": z.object({ user: z.object({ id: z.string() }) }) },
  });
  const app: TailorKitApp = {
    id: "app",
    views: [{ instances: true, path: "/", slot: "page" }],
  };
  const store = createTailorKitStore({
    apps: [app],
    baseUrl: client.baseUrl,
    client,
    contract,
  });
  const instances = vi
    .spyOn(client.endpoints, "slotInstances")
    .mockResolvedValue([]);
  const id = Symbol("identity");
  const original = {
    extra: true,
    user: { email: "private@example.com", id: "u1" },
  };
  store.views.register({ context: original, id, view: "/" });
  await Promise.resolve();
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(vi.fn());
  await vi.waitFor(() => expect(query.state.get().isSuccess).toBe(true));
  expect(instances).toHaveBeenCalledExactlyOnceWith(
    app,
    {
      context: { user: { id: "u1" } },
      path: "/",
      slot: "page",
    },
    expect.any(AbortSignal)
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(original.user.email).toBe("private@example.com");
  stop();
  store.views.unregister(id);
});
