import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createPatchsmithServer } from "./handler";

const setup = () => {
  const platformFetch = vi.fn<typeof fetch>();

  const authenticate = vi.fn(() => ({
    scopes: { workspace: { id: "verified" } },
    subjectId: "viewer",
  }));

  const server = createPatchsmithServer({
    $internal: { platformFetch },
    baseUrl: "https://host.test/api/patchsmith",
    components: {},
    scopes: { workspace: z.object({ id: z.string() }) },
    slots: { page: { multiple: true, views: ["/"] } },
    views: { "/": z.object({}) },
  });

  return { authenticate, platformFetch, server };
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
