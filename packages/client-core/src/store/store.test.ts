import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createPatchsmithFetchClient } from "#client/fetch-client";
import { toBaseUrl } from "#client/url";
import { testContract } from "#test-contract";
import type { PatchsmithApp } from "#types";

import { createPatchsmithStore } from "./store";

afterEach(() => vi.unstubAllGlobals());

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

describe("client stores", () => {
  it("normalizes endpoints without changing the input URL", () => {
    const input = new URL("https://host.test/api/patchsmith?token=test");
    expect(toBaseUrl(input).href).toBe(
      "https://host.test/api/patchsmith/?token=test"
    );
    expect(input.pathname).toBe("/api/patchsmith");
  });

  it.each([
    "https://other.test/api",
    "https://host.test/other",
    "https://host.test/api?token=other",
  ])(
    "rejects the mismatched endpoint %s before creating fetch stores",
    (baseUrl) => {
      const client = createPatchsmithFetchClient({
        baseUrl: "https://host.test/api",
      });

      const apps = vi.spyOn(client, "apps");
      expect(() =>
        createPatchsmithStore({
          apps: undefined,
          baseUrl,
          client,
          contract: testContract(),
        })
      ).toThrow(
        "createPatchsmithStore: baseUrl does not match the supplied fetch client."
      );
      expect(apps).not.toHaveBeenCalled();
    }
  );

  it.each(["https://HOST.test:443/api", new URL("https://host.test/api/")])(
    "accepts the equivalent normalized endpoint %s",
    (baseUrl) => {
      const client = createPatchsmithFetchClient({
        baseUrl: "https://host.test/api/",
      });

      const store = createPatchsmithStore({
        apps: undefined,
        baseUrl,
        client,
        contract: testContract(),
      });

      expect(store.client).toBe(client);
      expect(store.baseUrl.href).toBe("https://host.test/api/");
    }
  );

  it("shares discovery requests and retains snapshots across subscription lifecycles", async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn<typeof fetch>(async () => await response.promise);
    vi.stubGlobal("fetch", fetchMock);

    const store = createPatchsmithStore({
      baseUrl: "https://host.test/api/patchsmith",
      contract: testContract(),
    });

    const listener = vi.fn<Parameters<typeof store.subscribeApps>[0]>();
    const stop = store.subscribeApps(listener);
    const first = store.fetchApps();
    expect(store.fetchApps()).toBe(first);
    expect(store.getAppsSnapshot().status).toBe("loading");
    response.resolve(
      Response.json([{ id: "app", views: [{ path: "/home", slot: "panel" }] }])
    );
    await first;
    const ready = store.getAppsSnapshot();
    expect(ready.status).toBe("ready");
    expect(store.fetch.apps.getSnapshot()).toBe(ready);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    stop();
    const stopAgain = store.subscribeApps(listener);
    await store.fetchApps();
    expect(store.getAppsSnapshot()).toBe(ready);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://host.test/api/patchsmith/apps"),
      expect.objectContaining({
        credentials: "same-origin",
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    stopAgain();
  });

  it("ignores stale discovery responses when a forced request finishes first", async () => {
    const old = deferredResponse();
    const current = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise)
    );

    const store = createPatchsmithStore({
      baseUrl: "https://host.test/",
      contract: testContract(),
    });

    const first = store.fetchApps();
    await Promise.resolve();
    const second = store.fetchApps({ force: true });
    current.resolve(Response.json([{ id: "current" }]));
    await second;
    const ready = store.getAppsSnapshot();
    old.resolve(Response.json([{ id: "old" }]));
    await first;
    expect(store.getAppsSnapshot()).toBe(ready);
    expect(ready.apps).toEqual([{ id: "current" }]);
  });

  it("keeps provided apps authoritative while discovery is pending", async () => {
    const response = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await response.promise)
    );

    const store = createPatchsmithStore({
      baseUrl: "https://host.test/",
      contract: testContract(),
    });

    const pending = store.fetchApps();
    const apps: PatchsmithApp[] = [{ id: "provided" }];
    store.setProvidedApps(apps);
    response.resolve(Response.json([{ id: "remote" }]));
    await pending;
    await store.fetchApps({ force: true });
    expect(store.getAppsSnapshot().apps).toBe(apps);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("resumes discovery when provided apps are removed with an active subscriber", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json([{ id: "remote" }]));

    vi.stubGlobal("fetch", fetchMock);

    const store = createPatchsmithStore({
      apps: [{ id: "provided" }],
      baseUrl: "https://host.test/",
      contract: testContract(),
    });

    const firstStop = store.subscribeApps(
      vi.fn<NonNullable<Parameters<typeof store.subscribeApps>[0]>>()
    );

    const stop = store.subscribeApps(
      vi.fn<NonNullable<Parameters<typeof store.subscribeApps>[0]>>()
    );

    await store.fetchApps();
    firstStop();
    firstStop();
    store.setProvidedApps(undefined);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    await store.fetchApps();
    expect(store.getAppsSnapshot().apps).toEqual([{ id: "remote" }]);
    stop();
  });

  it("recovers from failed requests and keeps client instances isolated", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce("offline")
      .mockResolvedValueOnce(Response.json([{ id: "remote" }]));

    vi.stubGlobal("fetch", fetchMock);

    const first = createPatchsmithStore({
      baseUrl: "https://host.test/",
      contract: testContract(),
    });

    const second = createPatchsmithStore({
      baseUrl: "https://other.test/",
      contract: testContract(),
    });

    await first.fetchApps();
    expect(first.getAppsSnapshot().error?.message).toBe("offline");
    expect(first.getAppsSnapshot().status).toBe("error");
    await first.fetchApps({ force: true });
    expect(first.getAppsSnapshot()).toMatchObject({
      error: null,
      status: "ready",
    });
    expect(second.getAppsSnapshot()).toMatchObject({
      apps: [],
      status: "idle",
    });
  });
});
