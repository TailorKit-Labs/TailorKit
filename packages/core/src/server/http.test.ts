import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { Context } from "./context";
import { createPatchsmithServer } from "./handler";

const setup = () => {
  const platformFetch = vi.fn<typeof fetch>();

  const toolExecutor = vi
    .fn<NonNullable<Context["toolExecutor"]>>()
    .mockResolvedValue(Response.json({ output: true }));

  const authenticate = vi.fn(() => ({
    scopes: { workspace: { id: "verified" } },
    subjectId: "viewer",
  }));

  const server = createPatchsmithServer({
    $internal: { platformFetch, toolExecutor },
    baseUrl: "https://host.test/api/patchsmith",
    components: {},
    scopes: { workspace: z.object({ id: z.string() }) },
    slots: { page: { multiple: true, views: ["/"] } },
    views: { "/": z.object({}) },
  });

  return { authenticate, platformFetch, server, toolExecutor };
};

const streamedRequest = (path: string, origin: string, chunk: Uint8Array) => {
  const pull = vi.fn(
    (controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(chunk);
      controller.close();
    }
  );

  const cancel = vi.fn();

  const init = {
    body: new ReadableStream({ cancel, pull }, { highWaterMark: 0 }),
    duplex: "half",
    headers: { "content-type": "application/json", origin },
    method: "POST",
  };

  return {
    cancel,
    pull,
    request: new Request(`https://host.test/api/patchsmith/${path}`, init),
  };
};

it("rejects origins and unauthenticated viewers before decoding a request body", async () => {
  const { authenticate, platformFetch, server } = setup();
  const bytes = new TextEncoder().encode("not json");
  const crossOrigin = streamedRequest("views", "https://attacker.test", bytes);
  const rejected = await server.handler(crossOrigin.request, { authenticate });
  expect(rejected.status).toBe(400);
  expect(crossOrigin.pull).not.toHaveBeenCalled();
  expect(authenticate).not.toHaveBeenCalled();

  const anonymous = streamedRequest("views", "https://host.test", bytes);

  const unauthorized = await server.handler(anonymous.request, {
    authenticate: () => null,
  });

  expect(unauthorized.status).toBe(401);
  expect(anonymous.pull).not.toHaveBeenCalled();
  expect(platformFetch).not.toHaveBeenCalled();
});

it("bounds streamed backend input before JSON decoding and platform access", async () => {
  const { authenticate, platformFetch, server } = setup();

  const input = streamedRequest(
    "backend/session",
    "https://host.test",
    new Uint8Array(4097)
  );

  const response = await server.handler(input.request, { authenticate });
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(authenticate).toHaveBeenCalledOnce();
  expect(platformFetch).not.toHaveBeenCalled();
});

it.each([false, true])(
  "rejects oversized tool bodies before execution (content length: %s)",
  async (declaredLength) => {
    const { authenticate, platformFetch, server, toolExecutor } = setup();

    const input = streamedRequest(
      "tools/execute",
      "https://app.test",
      new Uint8Array(1024 * 1024 + 1)
    );

    if (declaredLength) {
      input.request.headers.set("content-length", String(1024 * 1024 + 1));
    }

    const response = await server.handler(input.request, { authenticate });
    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authenticate).not.toHaveBeenCalled();
    expect(platformFetch).not.toHaveBeenCalled();
    expect(toolExecutor).not.toHaveBeenCalled();

    if (declaredLength) {
      expect(input.pull).not.toHaveBeenCalled();
    }
  }
);

it("accepts a streamed tool request at the serialized byte limit", async () => {
  const { authenticate, server, toolExecutor } = setup();

  const body = JSON.stringify({
    input: "é",
    path: "tool",
    requestId: "1a5febf3-e3af-4a01-89a7-35a4f1846114",
  });

  const padding = " ".repeat(
    1024 * 1024 - new TextEncoder().encode(body).byteLength
  );

  const input = streamedRequest(
    "tools/execute",
    "https://app.test",
    new TextEncoder().encode(body + padding)
  );

  const response = await server.handler(input.request, { authenticate });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ output: true });
  expect(toolExecutor).toHaveBeenCalledOnce();
  expect(authenticate).not.toHaveBeenCalled();
});

it("shares authentication between the transport guard and procedure middleware", async () => {
  const { authenticate, platformFetch, server } = setup();

  const response = await server.handler(
    new Request("https://host.test/api/patchsmith/views", {
      body: JSON.stringify({
        activeView: { layers: [], view: "/" },
        appIds: [],
        slot: "page",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { authenticate }
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [], status: "ready" });
  expect(response.headers.get("server-timing")).toMatch(
    /^views_auth;dur=\d+\.\d$/u
  );
  expect(authenticate).toHaveBeenCalledOnce();
  expect(platformFetch).not.toHaveBeenCalled();
});

it("restricts permissive preflight handling to explicitly marked routes", async () => {
  const { authenticate, server } = setup();

  const response = await server.handler(
    new Request("https://host.test/api/patchsmith/views", {
      headers: { origin: "https://attacker.test" },
      method: "OPTIONS",
    }),
    { authenticate }
  );

  expect(response.status).toBe(404);
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
  expect(authenticate).not.toHaveBeenCalled();
});
