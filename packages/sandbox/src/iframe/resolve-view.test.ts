import type { ViewLayer } from "@tailorkit/core/views";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";

import { assertAppClient, renderClient, resolveView } from "./resolve-view";
import type { AppClient, ViewRequest } from "./resolve-view";

const viewResolver = () => {
  const root = document.createElement("div");
  return (client: AppClient, props: ViewRequest) =>
    renderClient(client, props, root);
};

const viewClient = () => {
  const render = vi.fn();
  const navigation = { component: vi.fn() };
  const general = { component: vi.fn() };
  const detail = { component: vi.fn() };
  return {
    client: {
      $runtime: {
        h: <TComponent, TProps>(component: TComponent, props: TProps) => ({
          component,
          props,
        }),
        render,
      },
      slots: {
        navbar: { "/": navigation },
        panel: { "/users": general, "/users/detail": detail },
      },
    },
    detail,
    general,
    navigation,
    render,
  };
};

const viewLayers: [ViewLayer, ViewLayer, ViewLayer] = [
  { context: { workspaceId: "w1" }, path: "/", status: "ready" },
  { context: { canManageUsers: true }, path: "/users", status: "ready" },
  { context: { userId: "u1" }, path: "/users/detail", status: "ready" },
];

const resolveProps = (slot: string, layers: ViewLayer[] = viewLayers) => ({
  declaredViews: viewLayers.map((layer) => layer.path),
  layers,
  slot,
  supportedViews: slot === "navbar" ? ["/"] : ["/", "/users", "/users/detail"],
  view: "/users/detail",
});

describe("slot view resolution", () => {
  it("selects one view per slot and composes only its ancestors", () => {
    const resolve = viewResolver();
    const { client, navigation, detail, general, render } = viewClient();
    resolve(client, resolveProps("navbar"));
    expect(render.mock.calls[0]?.[0]).toEqual({
      component: navigation.component,
      props: {
        context: { workspaceId: "w1" },
        status: "ready",
        view: "/",
      },
    });
    resolve(client, resolveProps("panel"));
    expect(render.mock.calls[1]?.[0]).toEqual({
      component: detail.component,
      props: {
        context: { canManageUsers: true, userId: "u1", workspaceId: "w1" },
        status: "ready",
        view: "/users/detail",
      },
    });
    expect(
      render.mock.calls.some(([node]) => node?.component === general.component)
    ).toBe(false);
  });

  it.each(["loading", "error"] as const)(
    "keeps navbar ready when detail is %s",
    (status) => {
      const resolve = viewResolver();
      const { client, render } = viewClient();
      const layers = viewLayers.map((layer) =>
        layer.path === "/users/detail" ? { ...layer, status } : layer
      );
      resolve(client, resolveProps("navbar", layers));
      expect(render.mock.calls[0]?.[0].props.status).toBe("ready");
      resolve(client, resolveProps("panel", layers));
      expect(render.mock.calls[1]?.[0].props).toMatchObject({
        context: undefined,
        status,
        view: "/users/detail",
      });
    }
  );

  it("falls back within a slot using the parent's own readiness", () => {
    const resolve = viewResolver();
    const { client, general, render } = viewClient();
    const fallbackClient = {
      ...client,
      slots: { panel: { "/users": general } },
    };
    resolve(
      fallbackClient,
      resolveProps(
        "panel",
        viewLayers.map((layer) => ({
          ...layer,
          status: layer.path === "/users/detail" ? "error" : "ready",
        }))
      )
    );
    expect(render.mock.calls[0]?.[0]).toEqual({
      component: general.component,
      props: {
        context: { canManageUsers: true, workspaceId: "w1" },
        status: "ready",
        view: "/users",
      },
    });
  });

  it("clears an existing view for unsupported slots and blocked fallback", () => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, resolveProps("panel"));
    resolve(client, resolveProps("missing"));
    expect(render.mock.calls.at(-1)?.[0]).toBeNull();
    resolve(
      {
        ...client,
        slots: {
          panel: { "/": client.slots.navbar["/"], "/users": false },
        },
      },
      resolveProps("panel")
    );
    expect(render.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("does not expose partial context when an ancestor is missing or unavailable", () => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, resolveProps("panel", viewLayers.slice(1)));
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      context: undefined,
      status: "error",
    });
    resolve(
      client,
      resolveProps(
        "panel",
        viewLayers.map((layer) => ({
          ...layer,
          status: layer.path === "/" ? "loading" : "ready",
        }))
      )
    );
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      context: undefined,
      status: "loading",
    });
  });
});

it("limits matching to supported views while retaining ancestor data", () => {
  const resolve = viewResolver();
  const { client, general, render } = viewClient();
  resolve(client, { ...resolveProps("panel"), supportedViews: ["/users"] });
  expect(render.mock.calls.at(-1)?.[0]).toEqual({
    component: general.component,
    props: {
      context: { canManageUsers: true, workspaceId: "w1" },
      status: "ready",
      view: "/users",
    },
  });
  resolve(client, { ...resolveProps("panel"), supportedViews: [] });
  expect(render.mock.calls.at(-1)?.[0]).toBeNull();
});

it.each([null, undefined, { mount: () => {} }])(
  "rejects a module without a standard client (%j)",
  (client) => {
    expect(() => assertAppClient(client)).toThrow("app builder");
  }
);

it.each([42, 0, "user", "", true, false, null, ["u1"]])(
  "rejects non-object context %j without exposing partial ancestor data",
  (context) => {
    const resolve = viewResolver();
    const { client, render } = viewClient();
    resolve(client, {
      ...resolveProps("panel"),
      layers: viewLayers.map((layer) =>
        layer.path === "/users/detail" ? { ...layer, context } : layer
      ),
    });
    expect(render.mock.calls.at(-1)?.[0].props).toEqual({
      context: undefined,
      status: "error",
      view: "/users/detail",
    });
    resolve(client, resolveProps("panel"));
    expect(render.mock.calls.at(-1)?.[0].props).toMatchObject({
      context: { canManageUsers: true, userId: "u1", workspaceId: "w1" },
      status: "ready",
    });
  }
);

it("composes named array fields and omitted optional object contexts", () => {
  const resolve = viewResolver();
  const { client, render } = viewClient();
  resolve(client, {
    ...resolveProps("panel"),
    layers: [
      { context: undefined, path: "/", status: "ready" },
      { context: { userIds: ["u1", "u2"] }, path: "/users", status: "ready" },
      viewLayers[2],
    ],
  });
  expect(render.mock.calls.at(-1)?.[0].props).toEqual({
    context: { userId: "u1", userIds: ["u1", "u2"] },
    status: "ready",
    view: "/users/detail",
  });
});

describe("controlled slot rendering", () => {
  const request = {
    context: { canManageUsers: false, userId: "u2", workspaceId: "explicit" },
    controlled: true as const,
    declaredViews: ["/", "/users", "/users/detail"],
    slot: "panel",
    status: "ready" as const,
    supportedViews: ["/", "/users", "/users/detail"],
    view: "/users/detail",
  };

  it("renders the explicit view using the complete supplied context", () => {
    const { client, detail } = viewClient();
    expect(resolveView(client, request)).toEqual({
      component: detail.component,
      props: { context: request.context, status: "ready", view: request.view },
    });
  });

  it("does not fall back to a different app view or render an unsupported view", () => {
    const { client, general } = viewClient();
    expect(
      resolveView(
        { ...client, slots: { panel: { "/users": general } } },
        request
      )
    ).toBeNull();
    expect(
      resolveView(client, { ...request, supportedViews: ["/users"] })
    ).toBeNull();
    expect(
      resolveView(
        { ...client, slots: { panel: { "/users/detail": false } } },
        request
      )
    ).toBeNull();
  });

  it.each(["loading", "error"] as const)(
    "passes %s without exposing stale data",
    (status) => {
      const { client } = viewClient();
      expect(
        resolveView(client, { ...request, context: undefined, status })?.props
      ).toEqual({
        context: undefined,
        status,
        view: request.view,
      });
    }
  );

  it.each([null, undefined, [], 42, "invalid"])(
    "rejects invalid explicit context %j",
    (context) => {
      const { client } = viewClient();
      expect(
        // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        resolveView(client, { ...request, context } as unknown as ViewRequest)
          ?.props
      ).toEqual({
        context: undefined,
        status: "error",
        view: request.view,
      });
    }
  );
});

const clientImplementation = () => {
  const { client: clientValue, detail } = viewClient();
  return {
    ...clientValue,
    slots: {
      panel: {
        "/users/detail": { ...detail, instances: { resolver: "compiled" } },
      },
    },
  };
};

describe("instance rendering", () => {
  const instance = {
    data: { reportId: "r1" },
    key: "overview",
    metadata: { title: "Overview" },
  };
  const request = { ...resolveProps("panel"), instance };
  const client = clientImplementation;

  it("passes the selected instance alongside the matched context", () => {
    expect(resolveView(client(), request)?.props).toEqual({
      context: { canManageUsers: true, userId: "u1", workspaceId: "w1" },
      instance,
      status: "ready",
      view: "/users/detail",
    });
    const next = { data: null, key: "summary", metadata: {} };
    expect(
      resolveView(client(), { ...request, instance: next })?.props
    ).toMatchObject({
      instance: next,
    });
  });

  it.each(["loading", "error"] as const)(
    "strips stale instances when context is %s",
    (status) => {
      const layers = viewLayers.map((layer) =>
        layer.path === "/users/detail" ? { ...layer, status } : layer
      );
      expect(resolveView(client(), { ...request, layers })?.props).toEqual({
        context: undefined,
        status,
        view: "/users/detail",
      });
      expect(
        // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        resolveView(client(), {
          ...request,
          context: undefined,
          controlled: true,
          status,
        } as unknown as ViewRequest)?.props
      ).toEqual({ context: undefined, status, view: "/users/detail" });
    }
  );

  it("requires an instance for dynamic views and rejects instances on ordinary views", () => {
    expect(() => resolveView(client(), resolveProps("panel"))).toThrow(
      "requires a selected instance"
    );
    expect(() => resolveView(viewClient().client, request)).toThrow(
      "does not support instances"
    );
  });

  it.each([
    { ...instance, key: "" },
    { ...instance, key: 123 },
    { ...instance, metadata: [] },
    { ...instance, metadata: null },
  ])("rejects malformed instances %j", (invalid) => {
    // SAFETY: The exercised fetch call constructs this Request; the test inspects the captured request after asserting the call occurred.
    expect(() =>
      resolveView(client(), {
        ...request,
        instance: invalid,
      } as ViewRequest)
    ).toThrow("Invalid instance");
  });
});
