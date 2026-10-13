/* oxlint-disable typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/no-unsafe-assignment -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { defineContract } from "@tailorkit/core/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createClient } from "#index";
import type { TailorKitApp } from "#index";

const requireValue = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
const schema = {
  "~standard": {
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: (
      value: Parameters<StandardSchemaV1["~standard"]["validate"]>[0]
      // oxlint-disable-next-line typescript/no-generated-empty-object-type, typescript/no-unsafe-type-assertion -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys. This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    ) => ({ value: value as Record<never, never> }),
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
  baseUrl: "https://host.test/api/tailorkit/",
  contract,
});
const app: TailorKitApp = {
  currentDeployment: { id: "deployment_1" },
  id: "app_1",
  views: [
    { instances: true, path: "/", slot: "page" },
    { instances: true, path: "/customers/detail", slot: "page" },
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
const withApp = (
  instancesValue: { key: string; metadata: object; data: object }[],
  source = app
) => instancesValue.map((instance) => ({ ...instance, app: source }));

const url = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : String(input));

const mockFetch = () =>
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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

const calls = (path: string) =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => url(input).pathname.endsWith(path));

beforeEach(() => {
  apps = [app];
  mockFetch();
});
afterEach(() => {
  cleanup();
  client.clearCache();
  vi.restoreAllMocks();
});

const useDetail = (
  status: "ready" | "loading" | "error" = "ready",
  userId = "u1"
) => {
  client.useViewContext("/", { context: { user: { id: userId } } });
  client.useViewContext("/customers", { context: { canEdit: true } });
  client.useViewContext("/customers/detail", {
    context: { customer: { id: "c1" } },
    error: status === "error" ? new Error("Failed to load context") : null,
    loading: status === "loading",
  });
};

it.each(["apps", "single", "page"] as const)(
  "exposes only the simplified %s result and distinguishes pending from refetching",
  async (kind) => {
    apps = undefined;
    const discovered: TailorKitApp = {
      ...app,
      views: kind === "single" ? [{ path: "/", slot: "single" }] : app.views,
    };
    const pending: ((response: Response) => void)[] = [];
    const original = requireValue(
      vi.mocked(globalThis.fetch).getMockImplementation()
    );
    const requestPath = kind === "page" ? "/actions" : "/apps";
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      const path = url(input).pathname;
      if (path.endsWith(requestPath)) {
        return await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            pending.push(resolve);
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })();
      }
      if (path.endsWith("/apps")) {
        return Response.json([discovered]);
      }
      return await original(input, options);
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
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    expect(
      Object.keys(result.current).toSorted(
        (left, right) => Number(left > right) - Number(left < right)
      )
    ).toEqual(keys);
    expect(result.current).toMatchObject({
      data: undefined,
      error: null,
      isPending: true,
      isRefetching: false,
    });
    const { fetch } = result.current;
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    await act(async () => {
      requireValue(pending[0])(response());
    });
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
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
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await waitFor(() => {
      expect(result.current.isRefetching).toBe(true);
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(ready.data);
    expect(result.current.fetch).toBe(fetch);
    await act(async () => {
      requireValue(pending[1])(response());
      await refresh;
    });
    expect(
      Object.keys(result.current).toSorted(
        (left, right) => Number(left > right) - Number(left < right)
      )
    ).toEqual(keys);
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
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/backend/session")[0]?.[1]).toMatchObject({
    body: JSON.stringify({ appId: "app_1" }),
    method: "POST",
  });
  const [, options] = requireValue(calls("/actions")[0]);
  expect(new Headers(options?.headers).get("authorization")).toBe(
    "Bearer app-token"
  );

  expect(await new Response(options?.body).json()).toEqual({
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
  await waitFor(() => {
    expect(result.current.data).toEqual(
      withApp(instances, requireValue(requireValue(apps)[0]))
    );
  });

  const requestPayload = await new Response(
    calls("/actions")[0]?.[1]?.body
  ).json();
  expect(requestPayload.json.args).toEqual({
    context: { user: { id: "u1" } },
    path: "/",
    slot: "panel",
  });
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
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
  expect(result.current.data).toEqual(withApp(instances, disabledChildApp));
  expect(calls("/actions")).toHaveLength(1);

  expect(await new Response(calls("/actions")[0]?.[1]?.body).json()).toEqual({
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
  await waitFor(() => {
    expect(result.current.data).toEqual(withApp(instances));
  });
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
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  }
);

// oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
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
            kind === "disabled"
              ? {
                  disabled: true as const,
                  instances: true as const,
                  path: "/",
                  slot: "page",
                }
              : { instances: true as const, path: "/", slot: "page" },
            kind === "static"
              ? { path: "/customers/detail", slot: "page" }
              : {
                  disabled: true as const,
                  path: "/customers/detail",
                  slot: "page",
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
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
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
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
  rerender();
  expect(calls("/actions")).toHaveLength(1);
  await act(async () => {
    await result.current.fetch();
  });
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
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/actions")
      ? await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            pending.push({ resolve, signal: options?.signal });
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })()
      : await original(input, options)
  );
  const { result, rerender, unmount } = renderHook(
    ({ userId }) => {
      useDetail("ready", userId);
      return client.useViews({ slot: "page" });
    },
    { initialProps: { userId: "u1" }, wrapper }
  );
  await waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  rerender({ userId: "u2" });
  await waitFor(() => {
    expect(pending).toHaveLength(2);
  });
  expect(pending[0]?.signal?.aborted).toBe(true);
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[0]).resolve(Response.json({ json: instances }));
  });
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
  const fresh = [{ data: { userId: "u2" }, key: "fresh", metadata: {} }];
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[1]).resolve(Response.json({ json: fresh }));
  });
  expect(result.current.data).toEqual(withApp(fresh));
  rerender({ userId: "u3" });
  await waitFor(() => {
    expect(pending).toHaveLength(3);
  });
  expect(result.current.data).toBeUndefined();
  unmount();
  expect(pending[2]?.signal?.aborted).toBe(true);
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[2]).resolve(Response.json({ json: instances }));
  });
});

it("exposes resolver errors and allows retry through fetch", async () => {
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  let fail = true;

  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/actions")) {
      return Response.json(
        {
          json: {
            code: "FORBIDDEN",
            defined: false,
            message: "Reports unavailable",
          },
        },
        { status: 403 }
      );
    }
    return await original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current.error?.message).toBe("Reports unavailable");
  });
  expect(result.current.error).toBeInstanceOf(Error);
  fail = false;
  await act(async () => {
    await result.current.fetch();
  });
  expect(result.current.data).toEqual(withApp(instances));
  expect(result.current.error).toBeNull();
});

it("exposes session failures without sending an unauthenticated resolver call", async () => {
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(
    async (input, options) =>
      await (url(input).pathname.endsWith("/backend/session")
        ? new Response(null, { status: 401 })
        : original(input, options))
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current.error).toBeInstanceOf(Error);
  });
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
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
  apps = [{ ...app, currentDeployment: { id: "deployment_2" } }];
  rerender();
  await waitFor(() => {
    expect(calls("/actions")).toHaveLength(2);
  });
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
  apps = [{ ...app, currentDeployment: { id: "deployment_3" }, id: "app_2" }];
  rerender();
  await waitFor(() => {
    expect(
      result.current.data !== undefined && calls("/actions").length === 3
    ).toBe(true);
  });
  expect(calls("/backend/session")).toHaveLength(3);

  expect(
    await new Response(calls("/backend/session")[2]?.[1]?.body).json()
  ).toEqual({
    appId: "app_2",
  });
  expect(result.current.data?.[0]?.app).toEqual(apps[0]);
});

const strictWrapperImplementation = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <client.Provider apps={apps}>{children}</client.Provider>
  </StrictMode>
);

it("works in Strict Mode and isolates different roots", async () => {
  const strictWrapper = strictWrapperImplementation;
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
  await waitFor(() => {
    expect(
      first.result.current.data !== undefined &&
        second.result.current.data !== undefined
    ).toBe(true);
  });
  const resolvedUsers = await Promise.all(
    calls("/actions").map(async ([, options]) => {
      const request = await new Response(options?.body).json();
      return request.json.args.context.user.id;
    })
  );
  const users = resolvedUsers.toSorted(
    (left, right) => Number(left > right) - Number(left < right)
  );
  expect(users).toEqual(["u1", "u2"]);
});

it("rejects a hook used outside a Provider or under another client", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => client.useViews({ slot: "page" }))).toThrow(
    "useViews must be rendered inside a TailorKit Provider"
  );
  const other = createClient({ baseUrl: "https://other.test/api/", contract });

  expect(() =>
    renderHook(() => client.useViews({ slot: "page" }), {
      wrapper: other.Provider,
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
  await waitFor(() => {
    expect(
      first.result.current.every((query) => query.data !== undefined)
    ).toBe(true);
  });
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
  await waitFor(() => {
    expect(second.result.current.data).toBeDefined();
  });
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
  await waitFor(() => {
    expect(
      first.result.current.data !== undefined &&
        second.result.current.data !== undefined
    ).toBe(true);
  });
  expect(calls("/actions")).toHaveLength(1);
  first.unmount();
  expect(second.result.current.data).toEqual(withApp(instances));
});

it("discovers apps through useApps before resolving their instances", async () => {
  apps = undefined;
  let finishApps!: (response: Response) => void;
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/apps")
      ? await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            finishApps = resolve;
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })()
      : await original(input, options)
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(calls("/apps")).toHaveLength(1);
  });
  expect(result.current.isPending).toBe(true);
  expect(calls("/backend/session")).toHaveLength(0);
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  await act(async () => {
    finishApps(Response.json([app]));
  });
  await waitFor(() => {
    expect(result.current.data).toEqual(withApp(instances));
  });
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
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );

  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (url(input).pathname.endsWith("/backend/session")) {
      const { appId } = await new Response(options?.body).json();
      return Response.json({
        expiresAt: Date.now() + 300_000,
        token: appId,
        url: "https://runtime.test/rpc",
      });
    }
    if (url(input).pathname.endsWith("/actions")) {
      const body = await new Response(options?.body).text();
      return await (async () => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<Response>();
        try {
          pending.push({
            body,
            resolve,
            token: new Headers(options?.headers).get("authorization"),
          });
        } catch (error) {
          rejectPending(error);
        }
        return await pendingPromise;
      })();
    }
    return await original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(pending).toHaveLength(2);
  });
  expect(pending.map(({ token }) => token)).toEqual([
    "Bearer app_1",
    "Bearer app_2",
  ]);
  expect(pending.map(({ body }) => JSON.parse(body).json.args.path)).toEqual([
    "/customers/detail",
    "/",
  ]);
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[1]).resolve(Response.json({ json: instances }));
  });
  expect(result.current.isPending).toBe(true);
  expect(result.current.data).toBeUndefined();
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[0]).resolve(Response.json({ json: instances }));
  });
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
  await waitFor(() => {
    expect(result.current.data).toEqual([]);
  });
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
  await waitFor(() => {
    expect(result.current.data).toEqual([]);
  });
  expect(result.current.isPending).toBe(false);
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/apps")).toHaveLength(0);
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it("exposes app discovery failures and retries them through fetch", async () => {
  apps = undefined;
  let fail = true;
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );

  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/apps")) {
      return new Response(null, { status: 503 });
    }
    return await original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current.error).toBeInstanceOf(Error);
  });
  expect(result.current.error?.message).toContain(
    "Unable to fetch TailorKit apps"
  );
  expect(calls("/actions")).toHaveLength(0);
  fail = false;
  await act(async () => {
    await result.current.fetch();
  });
  await waitFor(() => {
    expect(result.current.data).toEqual(withApp(instances));
  });
  expect(calls("/apps")).toHaveLength(2);
});

it("cancels every app resolver and ignores late results when the app list changes", async () => {
  const second = { ...app, id: "app_2" };
  apps = [app, second];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/actions")
      ? await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            pending.push({ resolve, signal: options?.signal });
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })()
      : await original(input, options)
  );
  const { result, rerender, unmount } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(pending).toHaveLength(2);
  });
  apps = [second];
  rerender();
  await waitFor(() => {
    expect(pending).toHaveLength(3);
  });
  expect(
    pending.slice(0, 2).every(({ signal }) => signal?.aborted === true)
  ).toBe(true);
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    for (const request of pending.slice(0, 2)) {
      request.resolve(Response.json({ json: instances }));
    }
  });
  expect(result.current.data).toBeUndefined();
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[2]).resolve(Response.json({ json: instances }));
  });
  expect(result.current.data).toEqual(withApp(instances, second));
  act(() => {
    void result.current.fetch();
  });
  await waitFor(() => {
    expect(pending).toHaveLength(4);
  });
  unmount();
  expect(pending[3]?.signal?.aborted).toBe(true);
});

it("clears the aggregate and cancels remaining resolvers when any app fails", async () => {
  apps = [app, { ...app, id: "app_2" }];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/actions")
      ? await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            pending.push({ resolve, signal: options?.signal });
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })()
      : await original(input, options)
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useViews({ slot: "page" });
    },
    { wrapper }
  );
  await waitFor(() => {
    expect(pending).toHaveLength(2);
  });
  // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
  await act(async () => {
    requireValue(pending[0]).resolve(
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
    );
  });
  await waitFor(() => {
    expect(result.current.error).toBeInstanceOf(Error);
  });
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
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
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
    await waitFor(() => {
      expect(result.current.data).toEqual([{ app: singleApp }]);
    });
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
  await waitFor(() => {
    expect(result.current.data).toEqual([{ app: first }]);
  });
  rerender({ appIds: ["app_3"], scopes: undefined });
  await waitFor(() => {
    expect(result.current.data).toEqual([{ app: unscoped }]);
  });
  rerender({ appIds: undefined, scopes: [] });
  await waitFor(() => {
    expect(result.current.data).toEqual([]);
  });
  rerender({ appIds: [], scopes: undefined });
  await waitFor(() => {
    expect(result.current.data).toEqual([]);
  });
  apps = [{ ...second, name: "Updated" }];
  rerender({ appIds: undefined, scopes: undefined });
  await waitFor(() => {
    expect(result.current.data).toEqual([{ app: requireValue(apps)[0] }]);
  });
  expect(calls("/apps")).toHaveLength(0);
  expect(calls("/meta")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
});

it("shares app discovery with useApps and fetch refreshes single-slot entries", async () => {
  apps = undefined;
  let discovered: TailorKitApp[] = [
    { ...app, views: [{ path: "/", slot: "single" }] },
  ];
  const original = requireValue(
    vi.mocked(globalThis.fetch).getMockImplementation()
  );
  vi.mocked(globalThis.fetch).mockImplementation(
    async (input, options) =>
      await (url(input).pathname.endsWith("/apps")
        ? Response.json(discovered)
        : original(input, options))
  );
  const { result } = renderHook(
    () => ({
      apps: client.useApps(),
      slot: client.useViews({ slot: "single" }),
    }),
    { wrapper }
  );
  await waitFor(() => {
    expect(result.current.slot.data).toEqual([{ app: discovered[0] }]);
  });
  expect(calls("/apps")).toHaveLength(1);
  discovered = [{ ...requireValue(discovered[0]), id: "new-app" }];
  await act(async () => {
    await result.current.slot.fetch();
  });
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
  await waitFor(() => {
    expect(result.current.data).toEqual(withApp(instances, selected));
  });
  expect(calls("/backend/session")).toHaveLength(1);

  expect(
    await new Response(calls("/backend/session")[0]?.[1]?.body).json()
  ).toEqual({
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
  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
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
    const original = requireValue(
      vi.mocked(globalThis.fetch).getMockImplementation()
    );
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      const path = url(input).pathname;
      if (path.endsWith("/apps")) {
        return fail
          ? new Response(null, { status: 503 })
          : Response.json([discovered, excluded]);
      }
      if (path.endsWith("/actions")) {
        return await (async () => {
          const {
            promise: pendingPromise,
            resolve,
            reject: rejectPending,
          } = Promise.withResolvers<Response>();
          try {
            finishInstances = resolve;
          } catch (error) {
            rejectPending(error);
          }
          return await pendingPromise;
        })();
      }
      return await original(input, options);
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
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
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
      await waitFor(() => {
        expect(calls("/actions")).toHaveLength(1);
      });
      expect(complete).toBe(false);
      // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
      await act(async () => {
        finishInstances(Response.json({ json: instances }));
      });
    }
    await act(async () => {
      await pending;
    });
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
