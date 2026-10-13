import { defineContract } from "@tailorkit/core/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createClient } from "../index";
import type { TailorKitApp } from "../index";

const schema = {
  "~standard": {
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: (value: unknown) => ({ value: value as Record<never, never> }),
    vendor: "test",
    version: 1 as const,
  },
};
const contract = defineContract({
  components: {},
  scopes: { user: schema },
  slots: {
    default: { views: ["/"] },
    page: { multiple: true, views: ["/", "/customers", "/customers/detail"] },
    panel: { multiple: true, views: ["/"] },
    single: { multiple: false, views: ["/", "/customers/detail"] },
  },
  views: { "/": schema, "/customers": schema, "/customers/detail": schema },
});
const client = createClient({
  contract,
  baseUrl: "https://host.test/api/tailorkit/",
});
const app: TailorKitApp = {
  currentDeployment: { id: "deployment_1" },
  id: "app_1",
  views: [
    { slot: "page", path: "/", instances: true },
    { slot: "page", path: "/customers/detail", instances: true },
  ],
};
const instances = [
  {
    data: { reportId: "r1" },
    key: "overview",
    metadata: { title: "Overview" },
  },
];
let apps: TailorKitApp[] | undefined;
const wrapper = ({ children }: { children: ReactNode }) => (
  <client.Provider apps={apps}>{children}</client.Provider>
);
function withApp(
  instances: { key: string; metadata: object; data: object }[],
  source = app
) {
  return instances.map((instance) => ({ ...instance, app: source }));
}

function url(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input));
}

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = url(input).pathname;
    if (path.endsWith("/apps")) {
      return Response.json([app]);
    }
    if (path.endsWith("/backend/session")) {
      return Response.json({
        expiresAt: Date.now() + 300_000,
        token: "app-token",
        url: "https://runtime.test/rpc",
      });
    }
    if (path.endsWith("/actions")) {
      return Response.json({ json: instances });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function calls(path: string) {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => url(input).pathname.endsWith(path));
}

beforeEach(() => {
  apps = [app];
  mockFetch();
});
afterEach(() => {
  cleanup();
  client.clearCache();
  vi.restoreAllMocks();
});

function useDetail(
  status: "ready" | "loading" | "error" = "ready",
  userId = "u1"
) {
  client.useViewContext("/", { context: { user: { id: userId } } });
  client.useViewContext("/customers", { context: { canEdit: true } });
  client.useViewContext("/customers/detail", {
    context: { customer: { id: "c1" } },
    error: status === "error" ? new Error("Failed to load context") : null,
    loading: status === "loading",
  });
}

it.each(["apps", "single", "page"] as const)(
  "exposes only the simplified %s result and distinguishes pending from refetching",
  async (kind) => {
    apps = undefined;
    const discovered: TailorKitApp = {
      ...app,
      views: kind === "single" ? [{ path: "/", slot: "single" }] : app.views,
    };
    const pending: ((response: Response) => void)[] = [];
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    const requestPath = kind === "page" ? "/actions" : "/apps";
    vi.mocked(globalThis.fetch).mockImplementation((input, options) => {
      const path = url(input).pathname;
      if (path.endsWith(requestPath)) {
        return new Promise((resolve) => pending.push(resolve));
      }
      if (path.endsWith("/apps")) {
        return Promise.resolve(Response.json([discovered]));
      }
      return original(input, options);
    });
    const { result, rerender } = renderHook(
      () => {
        useDetail();
        return kind === "apps"
          ? client.useApps()
          : client.useViews({ slot: kind });
      },
      { wrapper }
    );
    const keys = ["data", "error", "fetch", "isPending", "isRefetching"];
    const response = () =>
      Response.json(kind === "page" ? { json: instances } : [discovered]);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(Object.keys(result.current).toSorted()).toEqual(keys);
    expect(result.current).toMatchObject({
      data: undefined,
      error: null,
      isPending: true,
      isRefetching: false,
    });
    const { fetch } = result.current;
    await act(async () => pending[0]!(response()));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.isPending).toBe(false);
    expect(result.current.isRefetching).toBe(false);
    expect(result.current.fetch).toBe(fetch);
    const ready = result.current;
    rerender();
    expect(result.current).toBe(ready);

    let refresh!: Promise<void>;
    act(() => {
      refresh = fetch();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    await waitFor(() => expect(result.current.isRefetching).toBe(true));
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(ready.data);
    expect(result.current.fetch).toBe(fetch);
    await act(async () => {
      pending[1]!(response());
      await refresh;
    });
    expect(Object.keys(result.current).toSorted()).toEqual(keys);
    expect(result.current.isRefetching).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  }
);

it("fetches the matched view's instances over authenticated HTTP with combined context", async () => {
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/backend/session")[0]?.[1]).toMatchObject({
    body: JSON.stringify({ appId: "app_1" }),
    method: "POST",
  });
  const [, options] = calls("/actions")[0]!;
  expect(new Headers(options?.headers).get("authorization")).toBe(
    "Bearer app-token"
  );
  expect(JSON.parse(String(options?.body))).toEqual({
    json: {
      args: {
        context: { canEdit: true, customer: { id: "c1" }, user: { id: "u1" } },
        path: "/customers/detail",
        slot: "page",
      },
      name: "_tailorkit.instances.resolve",
    },
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it("uses the closest supported ancestor and excludes deeper loading context", async () => {
  apps = [{ ...app, views: [{ instances: true, path: "/", slot: "panel" }] }];
  const { result } = renderHook(
    () => {
      useDetail("loading");
      return client.useViews({ slot: "panel" });
    },
    { wrapper }
  );
  await waitFor(() =>
    expect(result.current.data).toEqual(withApp(instances, apps![0]!))
  );
  expect(JSON.parse(String(calls("/actions")[0]?.[1]?.body)).json.args).toEqual(
    {
      context: { user: { id: "u1" } },
      path: "/",
      slot: "panel",
    }
  );
});

it("falls back to an enabled ancestor when the supported child is disabled", async () => {
  const disabledChildApp: TailorKitApp = {
    ...app,
    views: app.views?.map((view) =>
      view.path === "/customers/detail" ? { ...view, disabled: true } : view
    ),
  };
  apps = [disabledChildApp];
  const { result } = renderHook(
    () => {
      useDetail("loading");
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data).toEqual(withApp(instances, disabledChildApp));
  expect(calls("/actions")).toHaveLength(1);
  expect(JSON.parse(String(calls("/actions")[0]?.[1]?.body))).toEqual({
    json: {
      args: { context: { user: { id: "u1" } }, path: "/", slot: "page" },
      name: "_tailorkit.instances.resolve",
    },
  });
});

it("waits for every required ancestor before fetching instances", async () => {
  const { result, rerender } = renderHook(
    ({ ready }) => {
      client.useViewContext("/", {
        context: ready ? { user: { id: "u1" } } : undefined,
        loading: !ready,
      });
      client.useViewContext("/customers", { context: { canEdit: true } });
      client.useViewContext("/customers/detail", {
        context: { customer: { id: "c1" } },
      });
      return client.useViews({ slot: "page" });
    },
    { initialProps: { ready: false }, wrapper }
  );
  expect(calls("/meta")).toHaveLength(0);
  expect(result.current.isPending).toBe(true);
  expect(result.current.data).toBeUndefined();
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
  rerender({ ready: true });
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
});

it.each(["missing", "error", "invalid", "duplicate"] as const)(
  "exposes %s ancestor context as an error without calling the resolver",
  async (kind) => {
    const { result } = renderHook(
      () => {
        if (kind !== "missing") {
          client.useViewContext(
            "/",
            kind === "error"
              ? {
                  context: undefined,
                  error: new Error("Failed to load context"),
                }
              : { context: kind === "invalid" ? null : { user: { id: "u1" } } }
          );
        }
        client.useViewContext("/customers", {
          context:
            kind === "duplicate"
              ? { user: { id: "another" } }
              : { canEdit: true },
        });
        client.useViewContext("/customers/detail", {
          context: { customer: { id: "c1" } },
        });
        return client.useViews({ slot: "page" });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  }
);

it("stays idle for multiple slots without a registered view and never calls a resolver", async () => {
  const { result } = renderHook(() => client.useViews({ slot: "page" }), {
    wrapper,
  });
  expect(calls("/meta")).toHaveLength(0);
  expect(result.current.isRefetching).toBe(false);
  expect(result.current.isPending).toBe(true);
  expect(result.current.data).toBeUndefined();
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it.each(["static", "disabled", "unsupported", "legacy"] as const)(
  "returns an empty list for %s views without requesting instances",
  async (kind) => {
    const views =
      kind === "legacy"
        ? undefined
        : [
            {
              instances: true as const,
              path: "/",
              slot: "page",
              ...(kind === "disabled" ? { disabled: true as const } : {}),
            },
            {
              path: "/customers/detail",
              slot: "page",
              ...(kind === "static" ? {} : { disabled: true as const }),
            },
          ];
    apps = [{ ...app, views }];
    const { result } = renderHook(
      () => {
        useDetail();
        return client.useViews({
          slot: kind === "unsupported" ? "panel" : "page",
        });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([]);
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  }
);

it("does not refetch for equivalent inline objects and fetch refreshes instances", async () => {
  const { result, rerender } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  rerender();
  expect(calls("/actions")).toHaveLength(1);
  await act(() => result.current.fetch());
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/actions")).toHaveLength(2);
  expect(calls("/backend/session")).toHaveLength(1);
  expect(calls("/meta")).toHaveLength(0);
});

it("clears previous data and ignores late responses after context changes", async () => {
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) =>
          pending.push({ resolve, signal: options?.signal })
        )
      : original(input, options)
  );
  const { result, rerender, unmount } = renderHook(
    ({ userId }) => {
      useDetail("ready", userId);
      return client.useViews({ slot: "page" });
    },
    { initialProps: { userId: "u1" }, wrapper }
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  rerender({ userId: "u2" });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]?.signal?.aborted).toBe(true);
  await act(async () =>
    pending[0]!.resolve(Response.json({ json: instances }))
  );
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
  const fresh = [{ data: { userId: "u2" }, key: "fresh", metadata: {} }];
  await act(async () => pending[1]!.resolve(Response.json({ json: fresh })));
  expect(result.current.data).toEqual(withApp(fresh));
  rerender({ userId: "u3" });
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(result.current.data).toBeUndefined();
  unmount();
  expect(pending[2]?.signal?.aborted).toBe(true);
  await act(async () =>
    pending[2]!.resolve(Response.json({ json: instances }))
  );
});

it("exposes resolver errors and allows retry through fetch", async () => {
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/actions")) {
      return Response.json(
        {
          json: {
            code: "FORBIDDEN",
            message: "Reports unavailable",
            defined: false,
          },
        },
        { status: 403 }
      );
    }
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() =>
    expect(result.current.error?.message).toBe("Reports unavailable")
  );
  expect(result.current.error).toBeInstanceOf(Error);
  fail = false;
  await act(() => result.current.fetch());
  expect(result.current.data).toEqual(withApp(instances));
  expect(result.current.error).toBeNull();
});

it("exposes session failures without sending an unauthenticated resolver call", async () => {
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/backend/session")
      ? new Response(null, { status: 401 })
      : original(input, options)
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.error).toMatchObject({ code: "UNAUTHORIZED" });
  expect(calls("/actions")).toHaveLength(0);
});

it("reauthorizes when the discovered app or deployment changes", async () => {
  const { result, rerender } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  apps = [{ ...app, currentDeployment: { id: "deployment_2" } }];
  rerender();
  await waitFor(() => expect(calls("/actions")).toHaveLength(2));
  await waitFor(() => expect(result.current.data).toBeDefined());
  apps = [{ ...app, currentDeployment: { id: "deployment_3" }, id: "app_2" }];
  rerender();
  await waitFor(() =>
    expect(
      result.current.data !== undefined && calls("/actions").length === 3
    ).toBe(true)
  );
  expect(calls("/backend/session")).toHaveLength(3);
  expect(JSON.parse(String(calls("/backend/session")[2]?.[1]?.body))).toEqual({
    appId: "app_2",
  });
  expect(result.current.data?.[0]?.app).toEqual(apps[0]);
});

it("works in Strict Mode and isolates different roots", async () => {
  const strictWrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <client.Provider apps={apps}>{children}</client.Provider>
    </StrictMode>
  );
  const first = renderHook(
    () => {
      useDetail("ready", "u1");
      return client.useViews({ slot: "page" });
    },
    { wrapper: strictWrapper }
  );
  const second = renderHook(
    () => {
      useDetail("ready", "u2");
      return client.useViews({ slot: "page" });
    },
    { wrapper: strictWrapper }
  );
  await waitFor(() =>
    expect(
      first.result.current.data !== undefined &&
        second.result.current.data !== undefined
    ).toBe(true)
  );
  const users = calls("/actions")
    .map(
      ([, options]) =>
        JSON.parse(String(options?.body)).json.args.context.user.id
    )
    .sort();
  expect(users).toEqual(["u1", "u2"]);
});

it("rejects a hook used outside a Provider or under another client", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => client.useViews({ slot: "page" }))).toThrow(
    "useViews must be rendered inside a TailorKit Provider"
  );
  const other = createClient({ contract, baseUrl: "https://other.test/api/" });
  const wrongWrapper = ({ children }: { children: ReactNode }) => (
    <other.Provider>{children}</other.Provider>
  );
  expect(() =>
    renderHook(() => client.useViews({ slot: "page" }), {
      wrapper: wrongWrapper,
    })
  ).toThrow("useViews was created for a different TailorKit client");
});

it("shares one resolver across two hooks and retains data across remounts", async () => {
  const first = renderHook(
    () => {
      useDetail();
      return [
        client.useViews({ slot: "page" }),
        client.useViews({ slot: "page" }),
      ];
    },
    { wrapper }
  );
  await waitFor(() =>
    expect(
      first.result.current.every((query) => query.data !== undefined)
    ).toBe(true)
  );
  expect(calls("/actions")).toHaveLength(1);
  expect(calls("/backend/session")).toHaveLength(1);
  first.unmount();
  const second = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(second.result.current.data).toBeDefined());
  expect(calls("/actions")).toHaveLength(1);
  expect(calls("/meta")).toHaveLength(0);
});

it("shares identical instance requests across roots while keeping their registrations separate", async () => {
  const first = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  const second = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() =>
    expect(
      first.result.current.data !== undefined &&
        second.result.current.data !== undefined
    ).toBe(true)
  );
  expect(calls("/actions")).toHaveLength(1);
  first.unmount();
  expect(second.result.current.data).toEqual(withApp(instances));
});

it("discovers apps through useApps before resolving their instances", async () => {
  apps = undefined;
  let finishApps!: (response: Response) => void;
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/apps")
      ? new Promise((resolve) => {
          finishApps = resolve;
        })
      : original(input, options)
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(calls("/apps")).toHaveLength(1));
  expect(result.current.isPending).toBe(true);
  expect(calls("/backend/session")).toHaveLength(0);
  await act(async () => finishApps(Response.json([app])));
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
});

it("aggregates apps in discovery order, resolves in parallel, and preserves duplicate keys", async () => {
  const second = {
    ...app,
    id: "app_2",
    views: [{ instances: true as const, path: "/", slot: "page" }],
  };
  apps = [app, second, { id: "static", views: [{ path: "/", slot: "page" }] }];
  const pending: {
    token: string | null;
    body: string;
    resolve: (response: Response) => void;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (url(input).pathname.endsWith("/backend/session")) {
      const { appId } = JSON.parse(String(options?.body));
      return Response.json({
        expiresAt: Date.now() + 300_000,
        token: appId,
        url: "https://runtime.test/rpc",
      });
    }
    if (url(input).pathname.endsWith("/actions")) {
      return new Promise((resolve) =>
        pending.push({
          token: new Headers(options?.headers).get("authorization"),
          body: String(options?.body),
          resolve,
        })
      );
    }
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending.map(({ token }) => token)).toEqual([
    "Bearer app_1",
    "Bearer app_2",
  ]);
  expect(pending.map(({ body }) => JSON.parse(body).json.args.path)).toEqual([
    "/customers/detail",
    "/",
  ]);
  await act(async () =>
    pending[1]!.resolve(Response.json({ json: instances }))
  );
  expect(result.current.isPending).toBe(true);
  expect(result.current.data).toBeUndefined();
  await act(async () =>
    pending[0]!.resolve(Response.json({ json: instances }))
  );
  expect(result.current.data).toEqual([
    ...withApp(instances),
    ...withApp(instances, second),
  ]);
  expect(calls("/meta")).toHaveLength(0);
});

it("returns an empty result without requests when there are no apps or registered context", async () => {
  apps = [];
  const { result } = renderHook(() => client.useViews({ slot: "page" }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.data).toEqual([]));
  expect(result.current.isPending).toBe(false);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("returns an empty result with no app requests using the local contract", async () => {
  apps = [];
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.data).toEqual([]));
  expect(result.current.isPending).toBe(false);
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/apps")).toHaveLength(0);
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it("exposes app discovery failures and retries them through fetch", async () => {
  apps = undefined;
  let fail = true;
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/apps")) {
      return new Response(null, { status: 503 });
    }
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.error?.message).toContain(
    "Unable to fetch TailorKit apps"
  );
  expect(calls("/actions")).toHaveLength(0);
  fail = false;
  await act(() => result.current.fetch());
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
  expect(calls("/apps")).toHaveLength(2);
});

it("cancels every app resolver and ignores late results when the app list changes", async () => {
  const second = { ...app, id: "app_2" };
  apps = [app, second];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) =>
          pending.push({ resolve, signal: options?.signal })
        )
      : original(input, options)
  );
  const { result, rerender, unmount } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  apps = [second];
  rerender();
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(pending.slice(0, 2).every(({ signal }) => signal?.aborted)).toBe(true);
  await act(async () => {
    for (const request of pending.slice(0, 2)) {
      request.resolve(Response.json({ json: instances }));
    }
  });
  expect(result.current.data).toBeUndefined();
  await act(async () =>
    pending[2]!.resolve(Response.json({ json: instances }))
  );
  expect(result.current.data).toEqual(withApp(instances, second));
  await act(() => {
    void result.current.fetch();
  });
  await waitFor(() => expect(pending).toHaveLength(4));
  unmount();
  expect(pending[3]?.signal?.aborted).toBe(true);
});

it("clears the aggregate and cancels remaining resolvers when any app fails", async () => {
  apps = [app, { ...app, id: "app_2" }];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) =>
          pending.push({ resolve, signal: options?.signal })
        )
      : original(input, options)
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () =>
    pending[0]!.resolve(
      Response.json(
        {
          json: {
            code: "FORBIDDEN",
            defined: false,
            message: "App unavailable",
          },
        },
        { status: 403 }
      )
    )
  );
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.error?.message).toBe("App unavailable");
  expect(result.current.data).toBeUndefined();
  expect(pending[1]?.signal?.aborted).toBe(true);
});

it.each(["single", "default"] as const)(
  "lists one app per %s slot without registered context or instance requests",
  async (slot) => {
    const first: TailorKitApp = {
      ...app,
      views: [
        { path: "/", slot },
        { path: "/customers/detail", slot },
      ],
    };
    const second: TailorKitApp = { id: "app_2", views: [{ path: "/", slot }] };
    apps = [
      first,
      { id: "disabled", views: [{ disabled: true, path: "/", slot }] },
      { id: "unsupported", views: [{ path: "/unsupported", slot }] },
      { id: "other-slot", views: [{ path: "/", slot: "page" }] },
      {
        id: "invalid-instances",
        views: [{ instances: true, path: "/", slot }],
      },
      { id: "legacy" },
      second,
    ];
    const { result } = renderHook(() => client.useViews({ slot }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ app: first }, { app: second }]);
    expect(calls("/meta")).toHaveLength(0);
    expect(calls("/apps")).toHaveLength(0);
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  }
);

it.each(["loading", "error"] as const)(
  "discovers single-slot apps despite %s context on another page",
  async (status) => {
    const singleApp: TailorKitApp = {
      ...app,
      views: [{ path: "/", slot: "single" }],
    };
    apps = [singleApp];
    const { result } = renderHook(
      () => {
        client.useViewContext("/customers/detail", {
          context: undefined,
          error:
            status === "error" ? new Error("Failed to load context") : null,
          loading: status === "loading",
        });
        return client.useViews({ slot: "single" });
      },
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.data).toEqual([{ app: singleApp }])
    );
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  }
);

it("intersects scope and app filters and updates supplied single-slot apps", async () => {
  const first: TailorKitApp = {
    id: "app_1",
    scope: { name: "user" },
    views: [{ path: "/", slot: "single" }],
  };
  const second: TailorKitApp = { ...first, id: "app_2" };
  const unscoped: TailorKitApp = { id: "app_3", views: first.views };
  apps = [first, second, unscoped];
  const { result, rerender } = renderHook(
    ({
      scopes,
      appIds,
    }: {
      scopes?: readonly "user"[];
      appIds?: readonly string[];
    }) => client.useViews({ appIds, scopes, slot: "single" }),
    { initialProps: { appIds: ["app_1", "app_3"], scopes: ["user"] }, wrapper }
  );
  await waitFor(() => expect(result.current.data).toEqual([{ app: first }]));
  rerender({ appIds: ["app_3"], scopes: undefined });
  await waitFor(() => expect(result.current.data).toEqual([{ app: unscoped }]));
  rerender({ appIds: undefined, scopes: [] });
  await waitFor(() => expect(result.current.data).toEqual([]));
  rerender({ appIds: [], scopes: undefined });
  await waitFor(() => expect(result.current.data).toEqual([]));
  apps = [{ ...second, name: "Updated" }];
  rerender({ appIds: undefined, scopes: undefined });
  await waitFor(() => expect(result.current.data).toEqual([{ app: apps![0] }]));
  expect(calls("/apps")).toHaveLength(0);
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it("shares app discovery with useApps and fetch refreshes single-slot entries", async () => {
  apps = undefined;
  let discovered: TailorKitApp[] = [
    { ...app, views: [{ path: "/", slot: "single" }] },
  ];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/apps")
      ? Response.json(discovered)
      : original(input, options)
  );
  const { result } = renderHook(
    () => ({
      apps: client.useApps(),
      slot: client.useViews({ slot: "single" }),
    }),
    { wrapper }
  );
  await waitFor(() =>
    expect(result.current.slot.data).toEqual([{ app: discovered[0] }])
  );
  expect(calls("/apps")).toHaveLength(1);
  discovered = [{ ...discovered[0]!, id: "new-app" }];
  await act(() => result.current.slot.fetch());
  expect(result.current.slot.data).toEqual([{ app: discovered[0] }]);
  expect(result.current.apps.data).toEqual(discovered);
  expect(calls("/apps")).toHaveLength(2);
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it("filters multiple-slot apps before authorizing and resolving them", async () => {
  const selected: TailorKitApp = { ...app, scope: { name: "user" } };
  apps = [selected, { ...app, id: "other" }];
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({
        appIds: [selected.id],
        scopes: ["user"],
        slot: "page",
      });
    },
    { wrapper }
  );
  await waitFor(() =>
    expect(result.current.data).toEqual(withApp(instances, selected))
  );
  expect(calls("/backend/session")).toHaveLength(1);
  expect(JSON.parse(String(calls("/backend/session")[0]?.[1]?.body))).toEqual({
    appId: selected.id,
  });
  expect(calls("/actions")).toHaveLength(1);
});

it("retains single-slot entries when registered context changes", async () => {
  apps = [{ ...app, views: [{ path: "/", slot: "single" }] }];
  const { result, rerender } = renderHook(
    ({ userId }) => {
      useDetail("ready", userId);
      return client.useViews({ slot: "single" });
    },
    { initialProps: { userId: "u1" }, wrapper }
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  const previous = result.current.data;
  rerender({ userId: "u2" });
  await act(async () => {});
  expect(result.current.isPending).toBe(false);
  expect(result.current.data).toBe(previous);
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it.each(["page", "single"] as const)(
  "awaits the resulting %s query after retrying app discovery",
  async (slot) => {
    apps = undefined;
    let fail = true;
    let finishInstances!: (response: Response) => void;
    const discovered: TailorKitApp = {
      ...app,
      scope: { name: "user" },
      views: slot === "page" ? app.views : [{ path: "/", slot }],
    };
    const excluded: TailorKitApp = { ...discovered, id: "excluded" };
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation((input, options) => {
      const path = url(input).pathname;
      if (path.endsWith("/apps")) {
        return Promise.resolve(
          fail
            ? new Response(null, { status: 503 })
            : Response.json([discovered, excluded])
        );
      }
      if (path.endsWith("/actions")) {
        return new Promise((resolve) => {
          finishInstances = resolve;
        });
      }
      return original(input, options);
    });
    const { result } = renderHook(
      () => {
        useDetail();
        return client.useViews({
          appIds: [discovered.id],
          scopes: ["user"],
          slot,
        });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    fail = false;
    let complete = false;
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.fetch().then(() => {
        complete = true;
      });
    });
    expect(calls("/meta")).toHaveLength(0);
    if (slot === "page") {
      await waitFor(() => expect(calls("/actions")).toHaveLength(1));
      expect(complete).toBe(false);
      await act(async () => {
        finishInstances(Response.json({ json: instances }));
      });
    }
    await act(() => pending);
    expect(complete).toBe(true);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isRefetching).toBe(false);
    expect(result.current.data).toEqual(
      slot === "page" ? withApp(instances, discovered) : [{ app: discovered }]
    );
    expect(calls("/apps")).toHaveLength(2);
    expect(calls("/actions")).toHaveLength(slot === "page" ? 1 : 0);
  }
);
