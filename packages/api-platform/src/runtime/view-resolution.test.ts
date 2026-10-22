import { RPCSerializer } from "@orpc/server";
import type { Session } from "@patchsmith/app/client/connection";
import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { resolveRuntimeViews } from "./view-resolution";

const rootView = { instances: true as const, path: "/", slot: "page" };

const customerView = {
  instances: true as const,
  path: "/customers",
  slot: "page",
};

const app = { id: "installation", views: [rootView, customerView] };

const instance = {
  data: { id: "report" },
  key: "report",
  metadata: { title: "Report" },
};

const input = {
  contexts: [
    { context: { user: "viewer" }, path: "/", status: "ready" as const },
    {
      context: { customer: "customer", user: "viewer" },
      path: "/customers",
      status: "ready" as const,
    },
  ],
  slot: "page",
};

const setup = () => {
  const requests: Request[] = [];

  const fetch = vi.fn<typeof globalThis.fetch>(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    requests.push(request);
    // Exercise the real oRPC request encoding before returning the runtime response.
    await request.clone().json();

    return Response.json({ json: [instance] });
  });

  const createSession = vi.fn(
    asyncFixture((installation: { id: string }): Session => ({
      expiresAt: Date.now() + 300_000,
      identity: {
        appId: installation.id,
        deploymentId: "deployment",
        expiresAt: Date.now() + 300_000,
        installationId: installation.id,
        projectId: "project",
        scope: { name: "workspace", value: { id: "verified" } },
        subjectId: "viewer",
        toolUrl: "https://host.test/api/patchsmith/tools/execute",
      },
      token: `private-${installation.id}`,
      url: `https://runtime.test/${installation.id}/rpc`,
    }))
  );

  return { createSession, fetch, requests };
};

it("selects the closest enabled view and resolves instances with private installation sessions", async () => {
  const options = setup();
  const result = await resolveRuntimeViews([app], input, options);
  expect(result).toEqual({ data: [{ ...instance, app }], status: "ready" });
  expect(options.createSession).toHaveBeenCalledOnce();
  const [request] = options.requests;
  expect(request?.url).toBe("https://runtime.test/installation/rpc/actions");
  expect(request?.headers.get("authorization")).toBe(
    "Bearer private-installation"
  );
  expect(await request?.json()).toEqual({
    json: {
      args: {
        context: { customer: "customer", user: "viewer" },
        path: "/customers",
        slot: "page",
      },
      name: "_patchsmith.instances.resolve",
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-installation");
});

it("ignores invalid deeper context when that view is disabled and falls back to its ancestor", async () => {
  const options = setup();

  const installation = {
    ...app,
    views: [rootView, { ...customerView, disabled: true as const }].filter(
      (view) => view !== undefined
    ),
  };

  const result = await resolveRuntimeViews(
    [installation],
    {
      ...input,
      contexts: [
        input.contexts[0],
        { path: "/customers", status: "error" as const },
      ].filter((context) => context !== undefined),
    },
    options
  );

  expect(result.status).toBe("ready");
  expect(await options.requests[0]?.json()).toMatchObject({
    json: { args: { context: { user: "viewer" }, path: "/" } },
  });
});

it("restores native and binary contexts for multiple backends without mutating the input", async () => {
  const options = setup();

  const calls: {
    date: Date;
    count: bigint;
    tags: Map<string, number>;
    file: File;
  }[] = [];

  options.fetch.mockImplementation(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    const body = new RPCSerializer().deserialize(await request.formData());

    const parsed = z
      .object({
        args: z.object({
          context: z.object({
            count: z.bigint(),
            date: z.date(),
            file: z.instanceof(File),
            tags: z.map(z.string(), z.number()),
          }),
        }),
      })
      .parse(body);

    calls.push(parsed.args.context);

    return Response.json({ json: [instance] });
  });

  const request: Parameters<typeof resolveRuntimeViews>[1] = {
    contexts: [
      {
        context: {
          count: "42",
          date: "2026-10-22T00:00:00.000Z",
          file: {},
          tags: [["tag", 1]],
        },
        contextBlobs: [
          {
            data: "AAH/",
            lastModified: 123,
            name: "context.bin",
            type: "application/octet-stream",
          },
        ],
        contextMaps: [["file"]],
        contextMeta: [
          { path: ["date"], type: "date" },
          { path: ["count"], type: "bigint" },
          { path: ["tags"], type: "map" },
        ],
        path: "/",
        status: "ready" as const,
      },
    ],
    slot: "page",
  };

  const result = await resolveRuntimeViews(
    [
      { ...app, views: [rootView] },
      { ...app, id: "second", views: [rootView] },
    ],
    request,
    options
  );

  expect(result.status).toBe("ready");
  expect(calls).toHaveLength(2);

  for (const context of calls) {
    expect(context.date.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(context.count).toBe(42n);
    expect([...context.tags]).toEqual([["tag", 1]]);
    expect(context.file.name).toBe("context.bin");
    // oxlint-disable-next-line no-await-in-loop -- Verify each independently encoded runtime request's binary bytes.
    expect(new Uint8Array(await context.file.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 255])
    );
  }

  const [original] = request.contexts;

  if (original?.status !== "ready") {
    throw new Error("Expected ready source context");
  }

  expect(original.context.date).toBe("2026-10-22T00:00:00.000Z");
});

it("does not fall back through a closer view without instances", async () => {
  const options = setup();

  const result = await resolveRuntimeViews(
    [
      {
        ...app,
        views: [rootView, { path: "/customers", slot: "page" }].filter(
          (view) => view !== undefined
        ),
      },
    ],
    input,
    options
  );

  expect(result).toEqual({ data: [], status: "ready" });
  expect(options.createSession).not.toHaveBeenCalled();
  expect(options.fetch).not.toHaveBeenCalled();
});

it("rejects invalid context serialization before issuing sessions or starting apps", async () => {
  const options = setup();
  await expect(
    resolveRuntimeViews(
      [app],
      {
        contexts: [
          {
            context: { date: 42 },
            contextMeta: [{ path: ["date"], type: "date" }],
            path: "/customers",
            status: "ready",
          },
        ],
        slot: "page",
      },
      options
    )
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(options.createSession).not.toHaveBeenCalled();
  expect(options.fetch).not.toHaveBeenCalled();
});

it.each(["loading", "error"] as const)(
  "does not issue sessions or run any app when a selected context is %s",
  async (status) => {
    const options = setup();

    const run = resolveRuntimeViews(
      [{ ...app, id: "root-only", views: [rootView] }, app],
      {
        ...input,
        contexts: [
          { context: { user: "viewer" }, path: "/", status: "ready" },
          { path: "/customers", status },
        ],
      },
      options
    );

    if (status === "loading") {
      expect(await run).toEqual({ status: "loading" });
    } else {
      await expect(run).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }

    expect(options.createSession).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalled();
  }
);

it("fans out concurrently and aborts every backend request on client cancellation", async () => {
  const options = setup();
  options.fetch.mockImplementation(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    options.requests.push(request);
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

  const run = resolveRuntimeViews([app, { ...app, id: "second" }], input, {
    ...options,
    signal: controller.signal,
  });

  const rejected = expect(run).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  await vi.waitFor(() => {
    expect(options.requests).toHaveLength(2);
  });
  controller.abort();
  await rejected;
  expect(options.requests.every((request) => request.signal.aborted)).toBe(
    true
  );
});

it("does not start a backend after cancellation during session issuance", async () => {
  const options = setup();
  const controller = new AbortController();

  const createSession = async (installation: typeof app) => {
    controller.abort();

    return await options.createSession(installation);
  };

  await expect(
    resolveRuntimeViews([app], input, {
      ...options,
      createSession,
      signal: controller.signal,
    })
  ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  expect(options.fetch).not.toHaveBeenCalled();
});

it("cancels sibling resolvers when one app fails", async () => {
  const options = setup();
  const secondStarted = Promise.withResolvers<ReturnType<() => void>>();
  options.fetch.mockImplementation(async (value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    options.requests.push(request);

    if (options.requests.length === 1) {
      await secondStarted.promise;

      return Response.json(
        { json: { code: "UNAUTHORIZED", defined: false, message: "expired" } },
        { status: 401 }
      );
    }

    const { promise, reject } = Promise.withResolvers<Response>();
    request.signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Cancelled"));
      },
      { once: true }
    );
    secondStarted.resolve();

    return await promise;
  });

  await expect(
    resolveRuntimeViews([app, { ...app, id: "second" }], input, options)
  ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  expect(options.requests).toHaveLength(2);
  expect(options.requests[1]?.signal.aborted).toBe(true);
});

it.each([
  Response.json(
    { json: { code: "UNAUTHORIZED", defined: false, message: "expired" } },
    { status: 401 }
  ),
  Response.json({ json: [{ ...instance, key: 42 }] }),
  Response.json({ json: [instance, instance] }),
])(
  "does not retry failed actions or return invalid resolver output",
  async (response) => {
    const options = setup();
    options.fetch.mockResolvedValueOnce(response);
    await expect(
      resolveRuntimeViews([app], input, options)
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(options.createSession).toHaveBeenCalledOnce();
    expect(options.fetch).toHaveBeenCalledOnce();
  }
);
