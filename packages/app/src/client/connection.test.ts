import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createClient, reference } from "./connection";

const session = {
  expiresAt: Date.now() + 60_000,
  token: "token",
  url: "https://runtime.test/rpc/",
};

const readMutationRequest = async (init: RequestInit | undefined) =>
  z
    .object({
      json: z.object({
        args: z.unknown().optional(),
        name: z.string(),
        requestId: z.string(),
      }),
    })
    .parse(await new Response(init?.body).json());

it("routes normal calls over authenticated HTTP without opening a WebSocket", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ json: "ok" }));
  const connect = vi.fn();
  const client = createClient({
    connect,
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  const requestId = crypto.randomUUID();
  try {
    expect(
      await client.query(reference("todos.list", "query"), { filter: "open" })
    ).toBe("ok");
    fetch.mockResolvedValueOnce(Response.json({ json: "saved" }));
    expect(
      await client.mutate(
        reference("todos.add", "mutation"),
        { text: "todo" },
        { requestId }
      )
    ).toBe("saved");
    fetch.mockResolvedValueOnce(Response.json({ json: "done" }));
    expect(await client.action(reference("tasks.import", "action"))).toBe(
      "done"
    );

    expect(
      fetch.mock.calls.map(([url]) =>
        url instanceof Request ? url.url : String(url)
      )
    ).toEqual([
      "https://runtime.test/rpc/queries",
      "https://runtime.test/rpc/mutations",
      "https://runtime.test/rpc/actions",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        json: { args: { filter: "open" }, name: "todos.list" },
      }),
      credentials: "omit",
      method: "POST",
    });
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")
    ).toBe("Bearer token");

    const requestPayload = await readMutationRequest(fetch.mock.calls[1]?.[1]);
    expect(requestPayload.json).toEqual({
      args: { text: "todo" },
      name: "todos.add",
      requestId,
    });
    expect(connect).not.toHaveBeenCalled();
  } finally {
    client.close();
  }
});

it("preserves runtime errors without retrying actions", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json(
      {
        json: {
          code: "CONFLICT",
          defined: false,
          message: "Already imported",
        },
      },
      { status: 409 }
    )
  );
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    await expect(
      client.action(reference("import", "action"))
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Already imported",
    });
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    client.close();
  }
});

it("aborts pending HTTP calls when closed", async () => {
  let started!: () => void;
  const ready = (async () => {
    const {
      promise: pendingPromise,
      resolve,
      reject: rejectPending,
    } = Promise.withResolvers<ReturnType<() => void>>();
    try {
      started = resolve;
    } catch (error) {
      rejectPending(error);
    }
    await pendingPromise;
  })();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (_url, init) =>
      await (async () => {
        const {
          promise: pendingPromise,
          resolve: _resolve,
          reject,
        } = Promise.withResolvers<Response>();
        try {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Cancelled", "AbortError"));
            },
            { once: true }
          );
          started();
        } catch (error) {
          reject(error);
        }
        return await pendingPromise;
      })()
  );
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  const call = client.action(reference("import", "action"));
  const assertion = expect(call).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await ready;
  client.close();
  await assertion;
});

it("retries a lost mutation response with the same ID and frozen arguments", async () => {
  vi.useFakeTimers();
  const receipts = new Map<string, string>();
  let writes = 0;

  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const { json } = await readMutationRequest(init);
    const prior = receipts.get(json.requestId);
    if (prior !== undefined && prior !== null && prior !== "") {
      return Response.json({ json: prior });
    }
    writes += 1;
    receipts.set(
      json.requestId,
      z.object({ text: z.string() }).parse(json.args).text
    );
    throw new TypeError("Response lost after committing");
  });
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    const args = { text: "original" };
    const result = client.mutate(reference("todos.add", "mutation"), args);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    args.text = "changed";
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("original");
    expect(writes).toBe(1);
    const bodies = await Promise.all(
      fetch.mock.calls.map(async ([, init]) => {
        const request = await readMutationRequest(init);
        return request.json;
      })
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it("backs off transient mutation failures and preserves an explicit request ID", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("Gateway unavailable", { status: 502 }))
    .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 }))
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    const requestId = crypto.randomUUID();
    const result = client.mutate(reference("save", "mutation"), undefined, {
      requestId,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe("saved");
    const requestIds = await Promise.all(
      fetch.mock.calls.map(async ([, init]) => {
        const request = await readMutationRequest(init);
        return request.json.requestId;
      })
    );
    expect(requestIds).toEqual([requestId, requestId, requestId, requestId]);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it.each([
  "BAD_REQUEST",
  "FORBIDDEN",
  "CONFLICT",
  "INCOMPATIBLE_VERSION",
  "INTERNAL_SERVER_ERROR",
])("does not retry a mutation rejected with %s", async (code) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json(
        { json: { code, defined: false, message: "Rejected" } },
        { status: 500 }
      )
    );
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    await expect(
      client.mutate(reference("save", "mutation"))
    ).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    client.close();
  }
});

it("refreshes authentication once for a mutation without changing its request ID", async () => {
  const getSession = vi
    .fn<({ refresh }: { refresh: boolean }) => Promise<typeof session>>()
    .mockResolvedValueOnce({ ...session, token: "expired" })
    .mockResolvedValue({ ...session, token: "fresh" });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { json: { code: "UNAUTHORIZED", defined: false, message: "Expired" } },
        { status: 401 }
      )
    )
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({ fetch, getSession });
  try {
    expect(await client.mutate(reference("save", "mutation"))).toBe("saved");
    expect(getSession.mock.calls).toEqual([
      [{ refresh: false }],
      [{ refresh: true }],
    ]);
    const headers = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("authorization")
    );
    expect(headers).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  } finally {
    client.close();
  }
});

it("stops when refreshed authentication is still rejected", async () => {
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json(
      {
        json: { code: "UNAUTHORIZED", defined: false, message: "Rejected" },
      },
      { status: 401 }
    )
  );
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    await expect(
      client.mutate(reference("save", "mutation"))
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    client.close();
  }
});

it("cancels a mutation waiting to retry when the client closes", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError("Offline"));
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    const assertion = expect(
      client.mutate(reference("save", "mutation"))
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    client.close();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it.each(["query", "action"] as const)(
  "does not retry %s calls after a network failure",
  async (kind) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("Offline"));
    const client = createClient({
      fetch,
      getSession: vi
        .fn<() => Promise<typeof session>>()
        .mockResolvedValue(session),
    });
    try {
      const result =
        kind === "query"
          ? client.query(reference("read", "query"))
          : client.action(reference("external", "action"));
      await expect(result).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      client.close();
    }
  }
);

it("retries when the connection drops while reading a mutation response body", async () => {
  vi.useFakeTimers();
  const brokenResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("Response interrupted"));
      },
    }),
    { headers: { "content-type": "application/json" } }
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(brokenResponse)
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({
    fetch,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
  });
  try {
    const result = client.mutate(reference("save", "mutation"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("saved");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it("keeps reconnecting an active subscription beyond three failures", async () => {
  const socket = Object.assign(new EventTarget(), {
    close: vi.fn(),
    readyState: 1,
    send: vi.fn(),
  });
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  const connect = vi.fn(async () => {
    if (connect.mock.calls.length <= 5) {
      throw new Error("Offline");
    }
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    return socket as unknown as WebSocket;
  });
  const client = createClient({
    connect,
    getSession: vi
      .fn<() => Promise<typeof session>>()
      .mockResolvedValue(session),
    retryDelayMs: 0,
  });
  const stop = client.subscribe(
    reference("todos.list", "query"),
    {},
    vi.fn<NonNullable<Parameters<typeof client.subscribe>[2]>>()
  );
  try {
    await vi.waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(6);
    });
  } finally {
    stop();
    client.close();
  }
});
