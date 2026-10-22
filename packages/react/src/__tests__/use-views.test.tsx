import { asyncFixture } from "@patchsmith/config/testing";
import { defineContract } from "@patchsmith/core/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createClient } from "#index";

const contract = defineContract({
  scopes: { user: z.object({ id: z.string() }) },
  slots: {
    page: { multiple: true, views: ["/", "/customers"] },
    single: { views: ["/"] },
  },
  views: {
    "/": z.object({ user: z.object({ id: z.string() }) }),
    "/customers": z.object({ customer: z.string() }),
  },
});

const client = createClient({
  baseUrl: "https://host.test/api/patchsmith/",
  contract,
});

const app = {
  id: "app",
  views: [{ instances: true as const, path: "/", slot: "page" }],
};

const items = [
  {
    app,
    data: { report: "one" },
    key: "overview",
    metadata: { title: "Overview" },
  },
];

const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <client.Provider>{children}</client.Provider>
  </StrictMode>
);

const ready = () => Response.json({ data: items, status: "ready" });

afterEach(() => {
  cleanup();
  client.clearCache();
  vi.restoreAllMocks();
});

it("requests host-resolved views with parsed ancestor context and filters in one HTTP call", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(asyncFixture(ready));

  const { result } = renderHook(
    () => {
      client.useViewContext("/", { context: { user: { id: "u1" } } });
      client.useViewContext("/customers", { context: { customer: "c1" } });

      return client.useViews({
        appIds: ["app"],
        scopes: ["user"],
        slot: "page",
      });
    },
    { wrapper }
  );

  await waitFor(() => {
    expect(result.current.data).toEqual(items);
  });
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toEqual(new URL("https://host.test/api/patchsmith/views"));
  expect(init).toMatchObject({ credentials: "same-origin", method: "POST" });
  expect(await new Response(init?.body).json()).toEqual({
    activeView: {
      layers: [
        { context: { user: { id: "u1" } }, path: "/", status: "ready" },
        { context: { customer: "c1" }, path: "/customers", status: "ready" },
      ],
      view: "/customers",
    },
    appIds: ["app"],
    scopes: ["user"],
    slot: "page",
  });
});

it("shares requests between hooks and keeps the fetch callback and ready result stable", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(asyncFixture(ready));

  const { result, rerender } = renderHook(
    () => {
      client.useViewContext("/", { context: { user: { id: "u1" } } });

      return [
        client.useViews({ slot: "page" }),
        client.useViews({ slot: "page" }),
      ] as const;
    },
    { wrapper }
  );

  await waitFor(() => {
    expect(result.current[0].data).toEqual(items);
  });
  expect(result.current[1].data).toBe(result.current[0].data);
  expect(fetch).toHaveBeenCalledOnce();
  const [initial] = result.current;
  rerender();
  expect(result.current[0]).toBe(initial);
  await act(async () => {
    await initial.fetch();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current[0].fetch).toBe(initial.fetch);
});

it("retains data while refreshing and distinguishes initial pending state", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    pending.push(resolve);

    return await promise;
  });

  const { result } = renderHook(() => client.useViews({ slot: "single" }), {
    wrapper,
  });

  await waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  expect(result.current).toMatchObject({
    data: undefined,
    error: null,
    isPending: true,
    isRefetching: false,
  });
  act(() => {
    pending[0]?.(ready());
  });
  await waitFor(() => {
    expect(result.current.data).toEqual(items);
  });
  let refresh: Promise<void> | undefined;
  act(() => {
    refresh = result.current.fetch();
  });
  await waitFor(() => {
    expect(pending).toHaveLength(2);
  });
  expect(result.current).toMatchObject({
    data: items,
    isPending: false,
    isRefetching: true,
  });
  await act(async () => {
    pending[1]?.(ready());
    await refresh;
  });
  expect(result.current.isRefetching).toBe(false);
});

it("refetches with changed registered context", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(asyncFixture(ready));

  const { result, rerender } = renderHook(
    ({ userId }) => {
      client.useViewContext("/", { context: { user: { id: userId } } });

      return client.useViews({ slot: "page" });
    },
    { initialProps: { userId: "first" }, wrapper }
  );

  await waitFor(() => {
    expect(result.current.data).toEqual(items);
  });
  rerender({ userId: "second" });
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  expect(
    await new Response(fetch.mock.calls[1]?.[1]?.body).json()
  ).toMatchObject({
    activeView: { layers: [{ context: { user: { id: "second" } } }] },
  });
});

it("exposes host failures and recovers on fetch", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response("Unable to resolve views", { status: 502 })
    )
    .mockImplementation(asyncFixture(ready));

  const { result } = renderHook(() => client.useViews({ slot: "single" }), {
    wrapper,
  });

  await waitFor(() => {
    expect(result.current.error?.message).toBe("Unable to resolve views");
  });
  await act(async () => {
    await result.current.fetch();
  });
  expect(result.current).toMatchObject({
    data: items,
    error: null,
    isPending: false,
  });
});

it("exposes partial data and warnings without an error, then clears warnings on retry", async () => {
  const warnings = [
    {
      appId: "timed-out-app",
      code: "INSTANCE_RESOLUTION_TIMEOUT",
      message: "View resolution timed out",
      path: "/",
    },
  ];

  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({ data: items, status: "ready", warnings })
    )
    .mockImplementation(asyncFixture(ready));

  const { result } = renderHook(() => client.useViews({ slot: "single" }), {
    wrapper,
  });

  await waitFor(() => {
    expect(result.current.warnings).toEqual(warnings);
  });
  expect(result.current).toMatchObject({
    data: items,
    error: null,
    isPending: false,
  });
  await act(async () => {
    await result.current.fetch();
  });
  expect(result.current.warnings).toEqual([]);
  expect(result.current.data).toEqual(items);
});
