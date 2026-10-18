import { describe, expect, it } from "vite-plus/test";

import { createApiEntry } from "./entry";

describe("API server entry", () => {
  it("rejects unsupported methods before running the handler", async () => {
    let calls = 0;
    const entry = createApiEntry(() => {
      calls += 1;
      return new Response("ok");
    }, ["POST"]);

    const response = await entry.fetch(
      new Request("https://platform.test/api/test", { method: "PUT" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(calls).toBe(0);
  });

  it("preserves HTTP responses thrown by the shared route handler", async () => {
    const unauthorized = Response.json(
      { code: "UNAUTHORIZED" },
      { headers: { "www-authenticate": "Bearer" }, status: 401 }
    );
    const entry = createApiEntry(() => {
      // oxlint-disable-next-line typescript/only-throw-error -- Shared TanStack handlers throw HTTP responses; the standalone adapter must preserve them.
      throw unauthorized;
    }, ["POST"]);

    const response = await entry.fetch(
      new Request("https://platform.test/api/test", { method: "POST" })
    );

    expect(response).toBe(unauthorized);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("leaves unexpected failures to the server error boundary", async () => {
    const failure = new Error("storage unavailable");
    const entry = createApiEntry(() => {
      throw failure;
    }, ["GET"]);

    await expect(
      entry.fetch(new Request("https://platform.test/api/test"))
    ).rejects.toBe(failure);
  });

  it("returns a live stream and preserves the request cancellation signal", async () => {
    const abort = new AbortController();
    const request = new Request("https://platform.test/api/test", {
      method: "POST",
      signal: abort.signal,
    });
    const { promise, resolve } =
      Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
    const stream = new ReadableStream<Uint8Array>({ start: resolve });
    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream", "set-cookie": "test=1" },
    });
    const entry = createApiEntry(
      ({ request: incoming }) => {
        expect(incoming).toBe(request);
        return response;
      },
      ["POST"]
    );

    const result = await entry.fetch(request);
    expect(result).toBe(response);
    expect(result.headers.get("set-cookie")).toBe("test=1");
    const reader = result.body?.getReader();
    const controller = await promise;
    controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
    expect(await reader?.read()).toEqual({
      done: false,
      value: new TextEncoder().encode("data: ready\n\n"),
    });
    abort.abort();
    expect(request.signal.aborted).toBe(true);
    controller.close();
    expect(await reader?.read()).toEqual({ done: true, value: undefined });
  });
});
