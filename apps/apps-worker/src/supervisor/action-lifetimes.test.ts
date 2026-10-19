import { afterEach, expect, it, vi } from "vite-plus/test";

import { abortable } from "../runtime/cancellation";
import {
  createActionLeases,
  actionDestination,
  ActionCapability,
} from "./actions";

vi.mock("cloudflare:workers", () => ({ RpcTarget: vi.fn() }));

const identity = {
  appId: "app",
  deploymentId: "v1",
  expiresAt: Date.now() + 60_000,
  installationId: "install",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("admits actions without an application concurrency limit and revokes them on close", () => {
  const leases = createActionLeases();
  const active = Array.from({ length: 32 }, () => leases.open(identity));
  expect(active.every((lease) => !lease.signal.aborted)).toBe(true);
  for (const lease of active) {
    lease.close();
    expect(lease.signal.aborted).toBe(true);
  }
});

it("expires actions on cancellation or token expiry", async () => {
  vi.useFakeTimers();
  const leases = createActionLeases();
  const parent = new AbortController();
  const cancelled = leases.open(identity, parent.signal);
  const waiting = abortable(Promise.withResolvers().promise, cancelled.signal);
  const assertion = expect(waiting).rejects.toBeDefined();
  parent.abort();
  await assertion;
  expect(cancelled.signal.aborted).toBe(true);
  cancelled.close();
  const expiry = leases.open(identity);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(expiry.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(expiry.signal.aborted).toBe(true);
  expiry.close();
  expect(() => leases.open({ ...identity, expiresAt: Date.now() })).toThrow(
    "token expired"
  );
});

it.each([
  "http://example.com",
  "https://localhost",
  "https://127.0.0.1",
  "https://2130706433",
  "https://10.0.0.1",
  "https://172.16.0.1",
  "https://192.168.1.1",
  "https://169.254.169.254",
  "https://[::1]",
  "https://[::ffff:127.0.0.1]",
  "https://host.internal",
  "https://user:password@example.com",
])("blocks action egress to %s", (url) => {
  expect(() => {
    actionDestination(new URL(url));
  }).toThrow("public HTTPS");
});

it("allows HTTPS Internet destinations", () => {
  expect(() => {
    actionDestination(new URL("https://api.example.com/path"));
  }).not.toThrow();
});

it("cancels all active actions on deployment replacement", () => {
  const leases = createActionLeases();
  const first = leases.open(identity);
  const second = leases.open(identity);
  leases.closeAll();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(true);
  first.close();
  second.close();
  const next = leases.open(identity);
  expect(next.signal.aborted).toBe(false);
  next.close();
});

it("sends the verified app session directly to the product and rejects redirects", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(null, {
      headers: { location: "https://attacker.test" },
      status: 302,
    })
  );
  const lease = createActionLeases().open(identity);
  const capability = new ActionCapability(lease, async () => {}, {
    token: "verified-app-credential",
    url: identity.toolUrl,
  });
  try {
    await expect(
      capability.tool("customers.read", { id: "customer" })
    ).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toMatchObject([
      identity.toolUrl,
      {
        headers: { authorization: "Bearer verified-app-credential" },
        redirect: "manual",
      },
    ]);

    expect(
      await new Response(fetch.mock.calls[0]?.[1]?.body).json()
    ).toMatchObject({
      input: { id: "customer" },
      path: "customers.read",
    });
  } finally {
    lease.close();
  }
});
