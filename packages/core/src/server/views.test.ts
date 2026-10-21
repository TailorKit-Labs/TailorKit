import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { ActiveView, ViewsInput } from "#views";

import { createPatchsmithServer } from "./handler";

const app = {
  currentDeployment: { id: "deployment" },
  id: "installation",
  projectId: "project",
  scope: { name: "org", value: { id: "org" } },
  views: [
    { instances: true, path: "/", slot: "page" },
    { instances: true, path: "/customers", slot: "page" },
    { path: "/", slot: "single" },
  ],
};

const instance = {
  data: { id: "report" },
  key: "report",
  metadata: { title: "Report" },
};

const activeView: ActiveView = {
  layers: [
    { context: { extra: "discard", user: "user" }, path: "/", status: "ready" },
    { context: { customer: "customer" }, path: "/customers", status: "ready" },
  ],
  view: "/customers",
};

const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "installation",
  projectId: "project",
  scope: app.scope,
  subjectId: "principal",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

const viewRequest = (body?: ViewsInput, init: RequestInit = {}) =>
  new Request("https://host.test/api/patchsmith/views", {
    body: JSON.stringify(body ?? { activeView, slot: "page" }),
    headers: { "content-type": "application/json" },
    method: "POST",
    ...init,
  });

const setup = (apps = [app]) => {
  const platformBodies: {
    path: string;
    body: unknown;
    authorization: string | null;
  }[] = [];

  const actions: {
    body: unknown;
    authorization: string | null;
    signal: AbortSignal;
  }[] = [];

  const runtimeFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);

      actions.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
        signal: request.signal,
      });

      return Response.json({ json: [instance] });
    });

  const platformFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    platformBodies.push({
      authorization: request.headers.get("authorization"),
      body: await request.json(),
      path,
    });

    if (path.endsWith("/apps/list")) {
      return Response.json({ items: apps, pagination: { hasMore: false } });
    }

    if (path.endsWith("/apps/runtime/discover")) {
      return Response.json({
        items: apps.map((installation) => ({
          app: installation,
          session: {
            expiresAt: identity.expiresAt,
            identity: { ...identity, installationId: installation.id },
            token: `app-token-${installation.id}`,
            url: `https://runtime.test/${installation.id}/rpc`,
          },
        })),
        pagination: { hasMore: false },
      });
    }

    throw new Error(`Unexpected platform request: ${path}`);
  });

  const server = createPatchsmithServer({
    $internal: { platformFetch },
    baseUrl: "https://host.test/api/patchsmith",
    components: {},
    projectKey: "project-key",
    scopes: { org: z.object({ id: z.string() }) },
    slots: {
      page: { multiple: true, views: ["/", "/customers"] },
      single: { views: ["/"] },
    },
    views: {
      "/": z.object({ user: z.string() }),
      "/customers": z.object({ customer: z.string() }),
    },
  });

  const authenticate = vi.fn(() => ({
    scopes: { org: { id: "org" } },
    subjectId: "principal",
  }));

  const run = async (
    body?: Parameters<typeof viewRequest>[0],
    init?: RequestInit
  ) => await server.handler(viewRequest(body, init), { authenticate });

  return {
    actions,
    authenticate,
    platformBodies,
    platformFetch,
    request: viewRequest,
    run,
    runtimeFetch,
    server,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("discovers authorized apps on the host and calls the compiled action with validated composed context", async () => {
  const { actions, platformBodies, run } = setup();
  const response = await run();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    data: [{ ...instance, app }],
    status: "ready",
  });
  expect(platformBodies).toEqual([
    {
      authorization: "Bearer project-key",
      body: {
        page: 1,
        pageSize: 100,
        scopes: [app.scope],
        slot: "page",
        subjectId: "principal",
        toolUrl: identity.toolUrl,
        viewPaths: ["/customers", "/"],
      },
      path: "/api/platform/apps/runtime/discover",
    },
  ]);

  expect(actions).toMatchObject([
    {
      authorization: "Bearer app-token-installation",
      body: {
        json: {
          args: {
            context: { customer: "customer", user: "user" },
            path: "/customers",
            slot: "page",
          },
          name: "_patchsmith.instances.resolve",
        },
      },
    },
  ]);
});

it("resolves single slots on the host without authorizing an app backend", async () => {
  const { actions, platformBodies, run } = setup();
  const response = await run({ activeView, slot: "single" });
  expect(await response.json()).toEqual({ data: [{ app }], status: "ready" });
  expect(platformBodies).toHaveLength(1);
  expect(actions).toHaveLength(0);
});

it("falls back to an enabled ancestor and ignores deeper loading context", async () => {
  const ancestorApp = {
    ...app,
    views: [
      { instances: true, path: "/", slot: "page" },
      { disabled: true, instances: true, path: "/customers", slot: "page" },
    ],
  };

  const { actions, run } = setup([ancestorApp]);
  await run({
    activeView: {
      ...activeView,
      layers: activeView.layers.map((layer) =>
        layer.path === "/customers" ? { ...layer, status: "loading" } : layer
      ),
    },
    slot: "page",
  });
  expect(actions).toMatchObject([
    { body: { json: { args: { context: { user: "user" }, path: "/" } } } },
  ]);
});

it.each(["loading", "error", "missing", "invalid", "duplicate"])(
  "does not run any action when required context is %s",
  async (kind) => {
    const { actions, platformBodies, run } = setup([
      app,
      { ...app, id: "second" },
    ]);

    let { layers } = activeView;

    if (kind === "missing") {
      layers = layers.slice(0, 1);
    } else if (kind === "duplicate") {
      layers = [...layers, layers[0]].filter((layer) => layer !== undefined);
    } else if (kind === "invalid") {
      layers = layers.map((layer) =>
        layer.path === "/customers"
          ? { ...layer, context: { customer: 42 } }
          : layer
      );
    } else if (kind === "loading" || kind === "error") {
      layers = layers.map((layer) =>
        layer.path === "/customers" ? { ...layer, status: kind } : layer
      );
    }

    const response = await run({
      activeView: { ...activeView, layers },
      slot: "page",
    });

    expect(response.status).toBe(kind === "loading" ? 200 : 400);

    if (kind === "loading") {
      expect(await response.json()).toEqual({ status: "loading" });
    }

    expect(platformBodies).toHaveLength(kind === "duplicate" ? 0 : 1);
    expect(actions).toHaveLength(0);
  }
);

it("rejects unavailable scopes and ignores installation IDs outside discovery", async () => {
  const { actions, platformBodies, request, server, authenticate } = setup();

  const invalid = await server.handler(
    request({ activeView, scopes: ["other"], slot: "page" }),
    { authenticate }
  );

  expect(invalid.status).toBe(400);
  expect(platformBodies).toHaveLength(0);

  const selected = await server.handler(
    request({ activeView, appIds: ["outside"], slot: "page" }),
    { authenticate }
  );

  expect(await selected.json()).toEqual({ data: [], status: "ready" });
  expect(actions).toHaveLength(0);
});

it("requires authentication and rejects cross-origin and malformed requests", async () => {
  const { actions, platformBodies, request, server } = setup();

  const unauthorized = await server.handler(request(), {
    authenticate: () => null,
  });

  expect(unauthorized.status).toBe(401);

  for (const init of [
    {
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.test",
      },
    },
    { body: "invalid JSON" },
    { body: undefined, method: "GET" },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Assert each malformed request is rejected before issuing the next.
    const response = await server.handler(request(undefined, init), {
      authenticate: () => ({
        scopes: { org: { id: "org" } },
        subjectId: "principal",
      }),
    });

    expect(response.status).toBe(400);
  }

  expect(platformBodies).toHaveLength(0);
  expect(actions).toHaveLength(0);
});

it("resolves installations concurrently and aborts their actions when the request is cancelled", async () => {
  const { run, runtimeFetch, actions } = setup([app, { ...app, id: "second" }]);
  runtimeFetch.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    actions.push({
      authorization: request.headers.get("authorization"),
      body: await request.json(),
      signal: request.signal,
    });

    const { promise, reject } = Promise.withResolvers<Response>();
    request.signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Cancelled"));
      },
      { once: true }
    );

    return await promise;
  });
  const controller = new AbortController();
  const pending = run(undefined, { signal: controller.signal });
  await vi.waitFor(() => {
    expect(actions).toHaveLength(2);
  });
  controller.abort();
  const response = await pending;
  expect(response.status).toBe(502);
  expect(actions.every(({ signal }) => signal.aborted)).toBe(true);
  expect(
    actions
      .map(({ authorization }) => authorization)
      .toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))
  ).toEqual(["Bearer app-token-installation", "Bearer app-token-second"]);
});

it("flattens all app instances with one platform discovery call and keeps sessions private", async () => {
  const { run, platformBodies, actions } = setup([
    app,
    { ...app, id: "second" },
  ]);

  const response = await run();
  expect(await response.json()).toEqual({
    data: [
      { ...instance, app },
      { ...instance, app: { ...app, id: "second" } },
    ],
    status: "ready",
  });
  expect(platformBodies.map(({ path }) => path)).toEqual([
    "/api/platform/apps/runtime/discover",
  ]);
  expect(actions.map(({ authorization }) => authorization)).toEqual([
    "Bearer app-token-installation",
    "Bearer app-token-second",
  ]);
});

it("continues paginated runtime discovery after an empty filtered page", async () => {
  const { run, platformFetch, platformBodies } = setup();
  platformFetch.mockResolvedValueOnce(
    Response.json({ items: [], pagination: { hasMore: true } })
  );
  const response = await run();
  expect(response.status).toBe(200);
  expect(platformBodies).toMatchObject([{ body: { page: 2 } }]);
  expect(await response.json()).toEqual({
    data: [{ ...instance, app }],
    status: "ready",
  });
  expect(platformFetch).toHaveBeenCalledTimes(2);
});

it("does not retry failed resolver actions or issue another runtime session", async () => {
  const { run, runtimeFetch, platformBodies } = setup();
  runtimeFetch.mockResolvedValueOnce(
    Response.json(
      {
        json: {
          code: "UNAUTHORIZED",
          defined: false,
          message: "Expired session",
        },
      },
      { status: 401 }
    )
  );
  const response = await run();
  expect(response.status).toBe(502);
  expect(platformBodies.map(({ path }) => path)).toEqual([
    "/api/platform/apps/runtime/discover",
  ]);
  expect(runtimeFetch).toHaveBeenCalledTimes(1);
});
