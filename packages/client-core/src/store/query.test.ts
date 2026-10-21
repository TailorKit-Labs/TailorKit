import { asyncFixture } from "@patchsmith/config/testing";
import { defineContract } from "@patchsmith/core/schema";
import { allTasks } from "nanostores";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createPatchsmithFetchClient } from "#client/fetch-client";
import { testContract } from "#test-contract";
import type { PatchsmithApp } from "#types";

import {
  createAppsQuery,
  createAppViewsQuery,
  createViewsQuery,
} from "./query";
import { createPatchsmithStore } from "./store";

const setup = (multiple = true, apps?: PatchsmithApp[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/api/",
    fetch,
  });

  const store = createPatchsmithStore({
    apps,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(multiple),
  });

  const app: PatchsmithApp = {
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
  fetch.mockImplementation(
    async () =>
      await (async () => {
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

  const stop = query.state.listen(
    vi.fn<NonNullable<Parameters<typeof query.state.listen>[0]>>()
  );

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

it("fetches views without a client discovery request or provided app data", async () => {
  const { fetch, store, app } = setup(false, []);
  fetch.mockResolvedValue(Response.json({ data: [{ app }], status: "ready" }));
  const query = createViewsQuery(store, { slot: "page" });
  expect(fetch).not.toHaveBeenCalled();
  const stop = query.state.listen(() => {});
  await allTasks();
  expect(query.state.get()).toMatchObject({ data: [{ app }], isSuccess: true });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toEqual(
    new URL("https://host.test/api/views")
  );
  stop();
});

it("cancels obsolete context requests and ignores their late responses", async () => {
  const { fetch, store, app } = setup();

  const requests: {
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
  }[] = [];

  fetch.mockImplementation(async (_input, init) => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    requests.push({ resolve, signal: init?.signal });

    return await promise;
  });
  const id = Symbol("view");
  store.views.register({ context: { customer: "first" }, id, view: "/" });
  await Promise.resolve();
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(() => {});
  await vi.waitFor(() => {
    expect(requests).toHaveLength(1);
  });
  store.views.register({ context: { customer: "second" }, id, view: "/" });
  await vi.waitFor(() => {
    expect(requests).toHaveLength(2);
  });
  expect(requests[0]?.signal?.aborted).toBe(true);
  requests[1]?.resolve(
    Response.json({
      data: [{ app, data: {}, key: "second", metadata: {} }],
      status: "ready",
    })
  );
  await vi.waitFor(() => {
    expect(query.state.get().data?.[0]).toMatchObject({ key: "second" });
  });
  requests[0]?.resolve(Response.json({ data: [], status: "ready" }));
  await allTasks();
  expect(query.state.get().data?.[0]).toMatchObject({ key: "second" });
  stop();
  store.views.unregister(id);
});

it("refetches an explicit installation through the host with current context", async () => {
  const { fetch, store, app } = setup();
  fetch.mockResolvedValue(Response.json({ data: [], status: "ready" }));
  const query = createAppViewsQuery(store, app, "page");
  const id = Symbol("view");
  store.views.register({ context: { customer: "latest" }, id, view: "/" });
  await Promise.resolve();
  await query.refetch();
  expect(
    await new Response(fetch.mock.calls[0]?.[1]?.body).json()
  ).toMatchObject({
    activeView: { layers: [{ context: { customer: "latest" } }] },
    appIds: [app.id],
  });
  store.views.unregister(id);
});

it("keeps root-slot discovery stable across child context changes and refreshes with relevant context", async () => {
  const contract = defineContract({
    slots: { page: { multiple: true, views: ["/"] } },
    views: {
      "/": z.object({ page: z.string(), workspace: z.string() }),
      "/details": z.object({ selected: z.string() }),
    },
  });

  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      asyncFixture(() => Response.json({ data: [], status: "ready" }))
    );

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/api/",
    fetch,
  });

  const store = createPatchsmithStore({
    baseUrl: client.baseUrl,
    client,
    contract,
  });

  const root = Symbol("root");
  const child = Symbol("child");
  const context = { page: "/details", workspace: "first" };
  store.views.register({ context, id: root, view: "/" });
  await Promise.resolve();

  const query = createViewsQuery(store, {
    scopes: ["workspace"],
    slot: "page",
  });

  const stop = query.state.listen(() => {});
  await allTasks();
  expect(fetch).toHaveBeenCalledOnce();
  store.views.register({
    context: { selected: "one" },
    id: child,
    view: "/details",
  });
  await allTasks();
  await Promise.resolve();
  store.views.register({
    context: { selected: "two" },
    id: child,
    view: "/details",
  });
  await allTasks();
  expect(fetch).toHaveBeenCalledOnce();
  expect(query.state.get().isSuccess).toBe(true);
  await query.refetch();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await new Response(fetch.mock.calls[1]?.[1]?.body).json()).toEqual({
    activeView: {
      layers: [{ context, path: "/", status: "ready" }],
      view: "/",
    },
    scopes: ["workspace"],
    slot: "page",
  });
  store.views.register({
    context: { ...context, workspace: "second" },
    id: root,
    view: "/",
  });
  await allTasks();
  await vi.waitFor(() => {
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  stop();
  store.views.unregister(root);
  store.views.unregister(child);
});
