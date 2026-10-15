import { afterEach, expect, it, vi } from "vite-plus/test";

import { createSlotStore } from "#store/fetch/slot";
import { createTailorKitStore } from "#store/store";
import { testContract } from "#test-contract";

import { createTailorKitFetchClient } from "./fetch-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares endpoint responses across roots without sharing local view registrations", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: "app" }]));
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/api",
    fetch: fetchMock,
  });
  const first = createTailorKitStore({
    apps: undefined,
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });
  const second = createTailorKitStore({
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
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
  });
  const supplied = createTailorKitStore({
    apps: [{ id: "provided" }],
    baseUrl: client.baseUrl,
    client,
    contract: testContract(),
  });
  const remote = createTailorKitStore({
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
  const client = createTailorKitFetchClient({
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
  const first = createTailorKitFetchClient({
    baseUrl: "https://host.test/",
    fetch: firstFetch,
  });
  const second = createTailorKitFetchClient({
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

it("deduplicates instance requests and sessions across framework-neutral consumers", async () => {
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const fetchMock = vi.fn(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/meta")) {
      return Response.json({
        schema: {
          slots: { page: { multiple: true, views: ["/"] } },
          views: { "/": {} },
        },
      });
    }
    if (path.endsWith("/backend/session")) {
      return Response.json({
        expiresAt: Date.now() + 300_000,
        token: "token",
        url: "https://runtime.test/rpc",
      });
    }
    return Response.json({
      json: [{ data: {}, key: "overview", metadata: {} }],
    });
  });
  const client = createTailorKitFetchClient({
    baseUrl: "https://host.test/",
    fetch: fetchMock,
  });
  const contract = testContract(true);
  const options = {
    activeView: {
      layers: [
        { context: { userId: "user" }, path: "/", status: "ready" as const },
      ],
      view: "/",
    },
    apps: [
      {
        id: "app",
        views: [{ instances: true as const, path: "/", slot: "page" }],
      },
    ],
    slot: "page",
  };
  const first = createSlotStore(client, contract, options);
  const second = createSlotStore(client, contract, options);
  const stopFirst = first.subscribe(
    vi.fn<NonNullable<Parameters<typeof first.subscribe>[0]>>()
  );
  const stopSecond = second.subscribe(
    vi.fn<NonNullable<Parameters<typeof second.subscribe>[0]>>()
  );
  const pending = first.fetch();
  expect(second.fetch()).toBe(pending);
  await pending;
  expect(first.getSnapshot().data?.[0]).toMatchObject({ key: "overview" });
  expect(second.getSnapshot().data).toBe(first.getSnapshot().data);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  stopFirst();
  stopSecond();
});
