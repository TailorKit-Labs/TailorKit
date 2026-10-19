import { asyncFixture } from "@tailorkit/config/testing";
import { expect, it, vi } from "vite-plus/test";

import { createSessionProvider, parseSession } from "./session";

const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "app",
  projectId: "project",
  scope: { name: "workspace", value: {} },
  subjectId: "principal",
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
};

it.each([undefined, null, "", 123, "x".repeat(257)])(
  "rejects session identities without a valid subject: %j",
  async (subjectId) => {
    const response = {
      expiresAt: Date.now() + 300_000,
      identity: { ...identity, subjectId },
      token: "scoped",
      url: "https://runtime.test/rpc",
    };
    expect(() => parseSession(response)).toThrow();
    const provider = createSessionProvider({
      appId: "app",
      baseUrl: "https://host.test/api/tailorkit",
      fetch: asyncFixture(() => Response.json(response)),
    });
    await expect(provider({ refresh: false })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Invalid app session",
    });
  }
);

it("rejects the legacy reduced session even when it supplies a subject", async () => {
  const response = {
    expiresAt: Date.now() + 300_000,
    subjectId: "principal",
    token: "scoped",
    url: "https://runtime.test/rpc",
  };
  expect(() => parseSession(response)).toThrow();
  const provider = createSessionProvider({
    appId: "app",
    baseUrl: "https://host.test/api/tailorkit",
    fetch: asyncFixture(() => Response.json(response)),
  });
  await expect(provider({ refresh: false })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
});

it("deduplicates token requests, caches until renewal and sends only the host-bound app ID", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    asyncFixture(() =>
      Response.json({
        expiresAt: Date.now() + 300_000,
        identity,
        token: "scoped",
        url: "https://runtime.test/rpc",
      })
    )
  );
  const session = createSessionProvider({
    appId: "allowed",
    baseUrl: "https://host.test/api/tailorkit",
    fetch,
  });
  const [first, second] = await Promise.all([
    session({ refresh: false }),
    session({ refresh: false }),
  ]);
  expect(first).toEqual(second);
  expect(fetch).toHaveBeenCalledTimes(1);

  const requestedUrl = fetch.mock.calls[0]?.[0];
  expect(
    requestedUrl instanceof Request
      ? requestedUrl.url
      : requestedUrl?.toString()
  ).toBe("https://host.test/api/tailorkit/backend/session");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    body: JSON.stringify({ appId: "allowed" }),
    credentials: "same-origin",
  });
  await session({ refresh: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  await session({ refresh: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("renews cached sessions when one minute remains", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      asyncFixture(() =>
        Response.json({
          expiresAt: Date.now() + 300_000,
          identity,
          token: "scoped",
          url: "https://runtime.test/rpc",
        })
      )
    );
    const session = createSessionProvider({
      appId: "allowed",
      baseUrl: "https://host.test/api",
      fetch,
    });
    await session({ refresh: false });
    vi.setSystemTime(239_999);
    await session({ refresh: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(240_000);
    await session({ refresh: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it("does not cache failed authorization or malformed sessions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ token: "secret" }))
    .mockResolvedValueOnce(
      Response.json({
        expiresAt: Date.now() + 300_000,
        identity,
        token: "scoped",
        url: "https://runtime.test/rpc",
      })
    );
  const session = createSessionProvider({
    appId: "allowed",
    baseUrl: "https://host.test/api",
    fetch,
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(session({ refresh: false })).resolves.toMatchObject({
    token: "scoped",
  });
});

it("reports session network failures as retryable and allows the next request to recover", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(
      Response.json({
        expiresAt: Date.now() + 300_000,
        identity,
        token: "scoped",
        url: "https://runtime.test/rpc",
      })
    );
  const session = createSessionProvider({
    appId: "allowed",
    baseUrl: "https://host.test/api",
    fetch,
  });
  await expect(session({ refresh: false })).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(session({ refresh: false })).resolves.toMatchObject({
    token: "scoped",
  });
});
it("caches server-authenticated sessions without a subject cache key and refreshes their identity", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        expiresAt: Date.now() + 300_000,
        identity: { ...identity, subjectId: "first-user" },
        token: "first",
        url: "https://runtime.test/rpc",
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        expiresAt: Date.now() + 300_000,
        identity: { ...identity, subjectId: "next-user" },
        token: "refreshed",
        url: "https://runtime.test/rpc",
      })
    );
  const session = createSessionProvider({
    appId: "app",
    baseUrl: "https://product.test/api/",
    fetch,
  });
  await expect(session({ refresh: false })).resolves.toMatchObject({
    identity: { ...identity, subjectId: "first-user" },
    token: "first",
  });
  await expect(session({ refresh: false })).resolves.toMatchObject({
    identity: { ...identity, subjectId: "first-user" },
    token: "first",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(session({ refresh: true })).resolves.toMatchObject({
    identity: { ...identity, subjectId: "next-user" },
    token: "refreshed",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
