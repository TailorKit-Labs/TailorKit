import { asyncFixture } from "@patchsmith/config/testing";
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

const viewRequest = (body?: ViewsInput, init: RequestInit = {}) =>
  new Request("https://host.test/api/patchsmith/views", {
    body: JSON.stringify(body ?? { activeView, slot: "page" }),
    headers: { "content-type": "application/json" },
    method: "POST",
    ...init,
  });

const setup = (
  customerSchema: z.ZodType<{ customer: unknown }> = z.object({
    customer: z.string(),
  })
) => {
  const requests: Request[] = [];

  const runtimeFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("The host must not contact an app runtime"));

  const reply = vi.fn(
    asyncFixture(() =>
      Response.json(
        { data: [{ ...instance, app }], status: "ready", warnings: [] },
        {
          headers: {
            "server-timing":
              "views_discovery;dur=12.3, views_instances;dur=45.6",
          },
        }
      )
    )
  );

  const platformFetch = vi.fn<typeof fetch>(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    requests.push(request);
    await request.clone().json();

    return new URL(request.url).pathname.endsWith("/apps/list")
      ? Response.json({ items: [app], pagination: { hasMore: false } })
      : await reply();
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
      "/customers": customerSchema,
    },
  });

  const authenticate = vi.fn(() => ({
    scopes: { org: { id: "org" } },
    subjectId: "principal",
  }));

  const run = async (body?: ViewsInput, init?: RequestInit) =>
    await server.handler(viewRequest(body, init), { authenticate });

  return {
    authenticate,
    platformFetch,
    reply,
    requests,
    run,
    runtimeFetch,
    server,
  };
};

afterEach(() => vi.restoreAllMocks());

it("makes one platform request with authenticated scopes and validated composed contexts", async () => {
  const { requests, run, runtimeFetch } = setup();
  const response = await run();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("server-timing")).toMatch(
    /^views_auth;dur=\d+\.\d, views_platform;dur=\d+\.\d, views_discovery;dur=12\.3, views_instances;dur=45\.6$/u
  );
  expect(await response.json()).toEqual({
    data: [{ ...instance, app }],
    status: "ready",
    warnings: [],
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(
    "https://patchsmith.io/api/platform/apps/runtime/resolve"
  );
  expect(requests[0]?.redirect).toBe("error");
  expect(requests[0]?.headers.get("authorization")).toBe("Bearer project-key");
  expect(await requests[0]?.json()).toEqual({
    contexts: [
      {
        context: { customer: "customer", user: "user" },
        path: "/customers",
        status: "ready",
      },
      { context: { user: "user" }, path: "/", status: "ready" },
    ],
    scopes: [app.scope],
    slot: "page",
    subjectId: "principal",
    toolUrl: "https://host.test/api/patchsmith/tools/execute",
  });
  expect(runtimeFetch).not.toHaveBeenCalled();
});

it("resolves single slots without contacting an app backend", async () => {
  const { requests, run, runtimeFetch } = setup();
  const response = await run({ activeView, slot: "single" });
  expect(await response.json()).toEqual({
    data: [{ app }],
    status: "ready",
    warnings: [],
  });
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/platform/apps/list",
  ]);
  expect(runtimeFetch).not.toHaveBeenCalled();
});

it("preserves native and binary values produced by host context validation", async () => {
  const { run, requests } = setup(
    z.object({
      customer: z.string().transform(() => ({
        at: new Date("2026-10-22T00:00:00.000Z"),
        count: 42n,
        file: new File([new Uint8Array([0, 1, 255])], "context.bin", {
          lastModified: 123,
          type: "application/octet-stream",
        }),
        tags: new Map([["tag", 1]]),
      })),
    })
  );

  const response = await run();
  expect(response.status).toBe(200);
  expect(await requests[0]?.json()).toMatchObject({
    contexts: [
      {
        context: {
          customer: {
            at: "2026-10-22T00:00:00.000Z",
            count: "42",
            tags: [["tag", 1]],
          },
          user: "user",
        },
        contextBlobs: [
          {
            data: "AAH/",
            lastModified: 123,
            name: "context.bin",
            type: "application/octet-stream",
          },
        ],
        contextMaps: [["customer", "file"]],
        contextMeta: [
          { path: ["customer", "at"], type: "date" },
          { path: ["customer", "count"], type: "bigint" },
          { path: ["customer", "tags"], type: "map" },
        ],
        path: "/customers",
        status: "ready",
      },
      { context: { user: "user" }, path: "/", status: "ready" },
    ],
  });
});

it.each(["loading", "error", "missing", "invalid"])(
  "passes context readiness for platform selection when a deeper context is %s",
  async (kind) => {
    const { requests, run, runtimeFetch, reply } = setup();
    const status = kind === "loading" ? "loading" : "error";

    const layers =
      kind === "missing"
        ? activeView.layers.slice(0, 1)
        : activeView.layers.map((layer): ActiveView["layers"][number] => {
            if (layer.path !== "/customers") {
              return layer;
            }

            if (kind === "invalid") {
              return { ...layer, context: { customer: 42 } };
            }

            return { ...layer, status };
          });

    reply.mockResolvedValueOnce(
      status === "loading"
        ? Response.json({ status: "loading" })
        : new Response("Invalid view context", { status: 400 })
    );

    const response = await run({
      activeView: { ...activeView, layers },
      slot: "page",
    });

    expect(response.status).toBe(status === "loading" ? 200 : 400);

    if (status === "loading") {
      expect(await response.json()).toEqual({ status: "loading" });
    }

    expect(await requests[0]?.json()).toMatchObject({
      contexts: [
        { path: "/customers", status },
        { context: { user: "user" }, path: "/", status: "ready" },
      ],
    });
    expect(runtimeFetch).not.toHaveBeenCalled();
  }
);

it("leaves selection to the platform when a deeper context is invalid but an ancestor is usable", async () => {
  const { run, requests } = setup();

  const response = await run({
    activeView: {
      ...activeView,
      layers: [
        ...activeView.layers.slice(0, 1),
        { path: "/customers", status: "loading" },
      ],
    },
    slot: "page",
  });

  expect(response.status).toBe(200);
  expect(await requests[0]?.json()).toMatchObject({
    contexts: [
      { path: "/customers", status: "loading" },
      { path: "/", status: "ready" },
    ],
  });
});

it("rejects duplicate layers and unavailable scopes before contacting the platform", async () => {
  const { run, platformFetch } = setup();
  const [first] = activeView.layers;

  const duplicate = await run({
    activeView: {
      ...activeView,
      layers: first ? [...activeView.layers, first] : [],
    },
    slot: "page",
  });

  const scope = await run({ activeView, scopes: ["other"], slot: "page" });
  expect(duplicate.status).toBe(400);
  expect(scope.status).toBe(400);
  expect(platformFetch).not.toHaveBeenCalled();
});

it("passes app filters to the platform and returns no out-of-scope installations", async () => {
  const { run, requests, reply } = setup();
  reply.mockResolvedValueOnce(
    Response.json({ data: [], status: "ready", warnings: [] })
  );
  const response = await run({ activeView, appIds: ["outside"], slot: "page" });
  expect(await response.json()).toEqual({
    data: [],
    status: "ready",
    warnings: [],
  });
  expect(await requests[0]?.json()).toMatchObject({
    appIds: ["outside"],
    scopes: [app.scope],
  });
});

it("requires authentication and rejects cross-origin and malformed requests", async () => {
  const { platformFetch, server } = setup();

  const unauthorized = await server.handler(viewRequest(), {
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
    // oxlint-disable-next-line no-await-in-loop -- Check each rejection independently.
    const response = await server.handler(viewRequest(undefined, init), {
      authenticate: () => ({
        scopes: { org: { id: "org" } },
        subjectId: "principal",
      }),
    });

    expect(response.status).toBe(init.method === "GET" ? 404 : 400);
  }

  expect(platformFetch).not.toHaveBeenCalled();
});

it("propagates request cancellation to the single platform call", async () => {
  const { run, platformFetch } = setup();
  const signals: AbortSignal[] = [];
  platformFetch.mockImplementation(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    signals.push(request.signal);
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

  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });

  await vi.waitFor(() => {
    expect(signals).toHaveLength(1);
  });
  controller.abort();
  await rejected;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it.each([401, 404, 500, 502])(
  "does not fall back to host fan-out or retry platform failure %s",
  async (status) => {
    const { run, platformFetch, runtimeFetch } = setup();
    platformFetch.mockResolvedValueOnce(
      new Response("private upstream error", { status })
    );
    const response = await run();
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Unable to resolve views");
    expect(platformFetch).toHaveBeenCalledOnce();
    expect(runtimeFetch).not.toHaveBeenCalled();
  }
);

it("returns the platform's resolver timeout as a sanitized 504 without retrying", async () => {
  const { run, platformFetch, runtimeFetch } = setup();
  platformFetch.mockResolvedValueOnce(
    new Response("private timeout details", { status: 504 })
  );
  const response = await run();
  expect(response.status).toBe(504);
  expect(await response.text()).toBe("View resolution timed out");
  expect(platformFetch).toHaveBeenCalledOnce();
  expect(runtimeFetch).not.toHaveBeenCalled();
});

it("preserves successful data and per-app timeout warnings from the platform", async () => {
  const { reply, run, runtimeFetch } = setup();

  const partial = {
    data: [{ ...instance, app }],
    status: "ready",
    warnings: [
      {
        appId: "timed-out-installation",
        code: "INSTANCE_RESOLUTION_TIMEOUT",
        message: "View resolution timed out",
        path: "/customers",
      },
    ],
  };

  reply.mockResolvedValueOnce(Response.json(partial));
  const response = await run();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(partial);
  expect(runtimeFetch).not.toHaveBeenCalled();
});
