import { asyncFixture } from "@patchsmith/config/testing";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { createSlotStore } from "#store/fetch/slot";
import { createPatchsmithStore } from "#store/store";
import { testContract } from "#test-contract";

import { createPatchsmithFetchClient } from "./fetch-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares endpoint responses across roots without sharing local view registrations", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: "app" }]));

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/api",
    fetch: fetchMock,
  });

  const first = createPatchsmithStore({
    apps: undefined,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });

  const second = createPatchsmithStore({
    apps: undefined,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });

  const stop = second.subscribeApps(
    vi.fn<NonNullable<Parameters<typeof second.subscribeApps>[0]>>()
  );

  await Promise.all([first.fetchApps(), second.fetchApps()]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(second.getAppsSnapshot().apps).toBe(first.getAppsSnapshot().apps);
  first.views.register({ context: {}, id: Symbol("identity"), view: "/" });
  await Promise.resolve();
  expect(second.views.getSnapshot()).toBeNull();
  stop();
});

it("keeps supplied discovery data local while another root fetches", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json([{ id: "remote" }]));

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
  });

  const supplied = createPatchsmithStore({
    apps: [{ id: "provided" }],
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });

  const remote = createPatchsmithStore({
    apps: undefined,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });

  await Promise.all([supplied.fetchApps(), remote.fetchApps()]);
  expect(supplied.getAppsSnapshot().apps).toEqual([{ id: "provided" }]);
  expect(remote.getAppsSnapshot().apps).toEqual([{ id: "remote" }]);
  await supplied.fetchApps({ force: true });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("honors app freshness defaults", async () => {
  vi.useFakeTimers();

  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: "app" }]))
    .mockResolvedValueOnce(Response.json([{ id: "app" }]));

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    cache: { apps: { staleTime: 10 }, gcTime: Infinity },
    fetch: fetchMock,
  });

  await client.apps().fetch();
  vi.advanceTimersByTime(11);
  await client.apps().fetch();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await client.apps({ staleTime: Infinity }).fetch();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("isolates authenticated clients at the same endpoint and clears credentials with data", async () => {
  const firstFetch = vi
    .fn()
    .mockResolvedValue(Response.json([{ id: "first" }]));

  const secondFetch = vi
    .fn()
    .mockResolvedValue(Response.json([{ id: "second" }]));

  const first = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: firstFetch,
  });

  const second = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: secondFetch,
  });

  await first.apps().fetch();
  expect(second.apps().getSnapshot().status).toBe("idle");
  await second.apps().fetch();
  expect(second.apps().getSnapshot().data).toEqual([{ id: "second" }]);
  const provider = first.endpoints.getSessionProvider({ id: "app" });
  first.clear();
  expect(first.apps().getSnapshot().data).toBeUndefined();
  expect(first.endpoints.getSessionProvider({ id: "app" })).not.toBe(provider);
  expect(second.apps().getSnapshot().data).toEqual([{ id: "second" }]);
});

it("deduplicates host view requests across framework-neutral consumers", async () => {
  const app = { id: "app" };

  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    asyncFixture(() =>
      Response.json({
        data: [{ app, data: {}, key: "overview", metadata: {} }],
        status: "ready",
        warnings: [],
      })
    )
  );

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
  });

  const input = { activeView: null, slot: "page" };
  const first = createSlotStore(client, input);
  const second = createSlotStore(client, input);
  const pending = first.fetch();
  expect(second.fetch()).toBe(pending);
  await pending;
  expect(first.getSnapshot().data?.[0]).toMatchObject({ key: "overview" });
  expect(second.getSnapshot().data).toBe(first.getSnapshot().data);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    new URL("https://host.test/views"),
    expect.objectContaining({ method: "POST" })
  );
});

it("prefetches views without a contract, registered context store or UI runtime", async () => {
  const app = { id: "prefetched" };

  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      asyncFixture(() =>
        Response.json({ data: [{ app }], status: "ready", warnings: [] })
      )
    );

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch,
  });

  const input = { activeView: null, slot: "single" };
  const query = client.views(input);
  await query.fetch();
  expect(query.getSnapshot()).toMatchObject({
    data: { data: [{ app }], status: "ready", warnings: [] },
    status: "ready",
  });
  await client.views(input).fetch();
  expect(fetch).toHaveBeenCalledOnce();
  client.clear();
});
