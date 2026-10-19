import { createPatchSmithStore } from "@patchsmith/client-core";
import { defineContract } from "@patchsmith/core/schema";
import type { ViewContextValues } from "@patchsmith/core/views";
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { PatchSmithContext } from "#components/context";
import type { ViewState } from "#hooks/use-view-context";
import { createClient } from "#patchsmith";

const isViewContext = <TValue,>(
  value: TValue
): value is TValue & ViewContextValues =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const contextSchema: StandardSchemaV1<unknown, ViewContextValues | undefined> &
  StandardJSONSchemaV1<unknown, ViewContextValues | undefined> = {
  "~standard": {
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: (value) => {
      if (value === undefined || isViewContext(value)) {
        return { value };
      }
      return { issues: [{ message: "Expected view context fields." }] };
    },
    vendor: "test",
    version: 1,
  },
};
const contract = defineContract({
  components: {},
  scopes: { user: contextSchema },
  views: { "/": contextSchema },
});
type Options = ViewState<{ "/": typeof contextSchema }, "/">;

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = () => {
  const client = createClient({ baseUrl: "https://host.test", contract });
  const store = createPatchSmithStore({
    apps: [],
    baseUrl: client.baseUrl,
    client: client.fetchClient,
    contract,
  });
  const contextValue1 = Object.freeze({ client, store });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <PatchSmithContext.Provider value={contextValue1}>
        {children}
      </PatchSmithContext.Provider>
    </StrictMode>
  );
  return { client, store, wrapper };
};

it.each([
  { context: {}, options: { context: {} }, status: "ready" },
  { context: undefined, options: { context: undefined }, status: "ready" },
  {
    context: {},
    options: { context: {}, error: null, loading: false },
    status: "ready",
  },
  { context: {}, options: { context: {}, error: undefined }, status: "ready" },
  { context: {}, options: { context: {}, error: false }, status: "ready" },
  {
    context: undefined,
    options: { context: {}, loading: true },
    status: "loading",
  },
  {
    context: undefined,
    options: { context: {}, error: false, loading: true },
    status: "loading",
  },
  {
    context: undefined,
    options: { context: {}, error: true },
    status: "error",
  },
  {
    context: undefined,
    options: { context: {}, error: "Failed" },
    status: "error",
  },
  { context: undefined, options: { context: {}, error: "" }, status: "error" },
  {
    context: undefined,
    options: { context: {}, error: true, loading: true },
    status: "error",
  },
  {
    context: undefined,
    options: { context: {}, error: "", loading: true },
    status: "error",
  },
  {
    context: undefined,
    options: { context: {}, error: new Error("Failed") },
    status: "error",
  },
  {
    context: undefined,
    options: { context: {}, error: new Error("Failed"), loading: true },
    status: "error",
  },
])(
  "registers $status with context $context from query state",
  async ({ options, status, context }) => {
    const { client, store, wrapper } = setup();
    const { unmount } = renderHook(
      () => {
        client.useViewContext("/", options);
      },
      {
        wrapper,
      }
    );
    await waitFor(() => {
      expect(store.views.getSnapshot()).toEqual({
        layers: [{ context, path: "/", status }],
        view: "/",
      });
    });
    unmount();
    await waitFor(() => {
      expect(store.views.getSnapshot()).toBeNull();
    });
  }
);

it("updates loading, error, and ready context as query results change", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<ReturnType<() => void>, Options>(
    (options) => {
      client.useViewContext("/", options);
    },
    {
      initialProps: { context: undefined, loading: true },
      wrapper,
    }
  );
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("loading");
  });
  rerender({ context: {}, error: "", loading: true });
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "error" },
    ]);
  });
  rerender({ context: {}, error: false });
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: {}, path: "/", status: "ready" },
    ]);
  });
  rerender({ context: {}, loading: true });
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "loading" },
    ]);
  });
  rerender({ context: undefined });
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "ready" },
    ]);
  });
});

it("does not republish equivalent context or changes to ignored query data", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<ReturnType<() => void>, Options>(
    (options) => {
      client.useViewContext("/", options);
    },
    {
      initialProps: { context: {} },
      wrapper,
    }
  );
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("ready");
  });
  const listener = vi.fn<Parameters<typeof store.views.state.listen>[0]>();
  const stop = store.views.state.listen(listener);
  const snapshot = store.views.getSnapshot();
  act(() => {
    rerender({ context: {}, error: null, loading: false });
  });
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(snapshot);

  rerender({ context: {}, error: new Error("First failure") });
  await waitFor(() => {
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("error");
  });
  listener.mockClear();
  const errorSnapshot = store.views.getSnapshot();
  act(() => {
    rerender({
      context: undefined,
      error: new Error("Second failure"),
      loading: true,
    });
  });
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(errorSnapshot);
  stop();
});
