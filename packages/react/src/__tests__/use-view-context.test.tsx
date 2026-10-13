import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { createTailorKitStore } from "@tailorkit/client-core";
import { defineContract } from "@tailorkit/core/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { TailorkitContext } from "../components/context";
import type { ViewState } from "../hooks/use-view-context";
import { createClient } from "../tailorkit";

const contextSchema: StandardSchemaV1<
  unknown,
  Record<string, unknown> | undefined
> &
  StandardJSONSchemaV1<unknown, Record<string, unknown> | undefined> = {
  "~standard": {
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: (value) => ({
      value: value as Record<string, unknown> | undefined,
    }),
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
  const store = createTailorKitStore({
    apps: [],
    baseUrl: client.baseUrl,
    client: client.fetchClient,
    contract,
  });
  const contextValue1 = { client, store };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      {/* oxlint-disable-next-line react/jsx-no-constructed-context-values -- This fixture is created once outside the render callback and stays stable for the test. */}
      <TailorkitContext.Provider value={contextValue1}>
        {children}
      </TailorkitContext.Provider>
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
    const { unmount } = renderHook(() => client.useViewContext("/", options), {
      wrapper,
    });
    await waitFor(() =>
      expect(store.views.getSnapshot()).toEqual({
        layers: [{ context, path: "/", status }],
        view: "/",
      })
    );
    unmount();
    await waitFor(() => expect(store.views.getSnapshot()).toBeNull());
  }
);

it("updates loading, error, and ready context as query results change", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<ReturnType<() => void>, Options>(
    (options) => client.useViewContext("/", options),
    {
      initialProps: { context: undefined, loading: true },
      wrapper,
    }
  );
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("loading")
  );
  rerender({ context: {}, error: "", loading: true });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "error" },
    ])
  );
  rerender({ context: {}, error: false });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: {}, path: "/", status: "ready" },
    ])
  );
  rerender({ context: {}, loading: true });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "loading" },
    ])
  );
  rerender({ context: undefined });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { context: undefined, path: "/", status: "ready" },
    ])
  );
});

it("does not republish equivalent context or changes to ignored query data", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<ReturnType<() => void>, Options>(
    (options) => client.useViewContext("/", options),
    {
      initialProps: { context: {} },
      wrapper,
    }
  );
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("ready")
  );
  const listener = vi.fn();
  const stop = store.views.state.listen(listener);
  const snapshot = store.views.getSnapshot();
  await act(() => rerender({ context: {}, error: null, loading: false }));
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(snapshot);

  rerender({ context: {}, error: new Error("First failure") });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers[0]?.status).toBe("error")
  );
  listener.mockClear();
  const errorSnapshot = store.views.getSnapshot();
  await act(() =>
    rerender({
      context: undefined,
      error: new Error("Second failure"),
      loading: true,
    })
  );
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(errorSnapshot);
  stop();
});
