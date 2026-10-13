import { expect, it, vi } from "vite-plus/test";

import { cancellationStream } from "../runtime/cancellation";
import { ActionCapability } from "./actions";

// oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep the generator or mutable callback with its owning test or cancellation lifecycle.
vi.mock("cloudflare:workers", () => ({ RpcTarget: function RpcTarget() {} }));

const setup = () => {
  const controller = new AbortController();
  const notify = vi.fn(async (_tables: string[]) => {});
  const lease = { deadline: Date.now() + 30_000, signal: controller.signal };
  return {
    bridge: new ActionCapability(lease, notify),
    controller,
    lease,
    notify,
  };
};

it("reports committed tables even when the action is cancelled after committing", async () => {
  const { bridge, notify, controller } = setup();
  controller.abort();
  await bridge.committed(["todos"]);
  expect(notify).toHaveBeenCalledExactlyOnceWith(["todos"]);
  expect("runQuery" in bridge).toBe(false);
  expect("runMutation" in bridge).toBe(false);
});

it.each(["cancelled", "expired"])(
  "rejects %s outbound fetch",
  async (state) => {
    const { bridge, controller, lease } = setup();
    if (state === "cancelled") {
      controller.abort();
    } else {
      lease.deadline = Date.now();
    }
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        bridge.fetch(
          new Request("https://example.com"),
          cancellationStream(controller.signal)
        )
      ).rejects.toThrow("Action has ended");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      vi.unstubAllGlobals();
    }
  }
);

it("keeps response bodies alive and propagates per-request cancellation", async () => {
  const { bridge, controller } = setup();
  const caller = new AbortController();
  let outgoing!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_request, init) => {
      outgoing = init.signal;
      return Promise.resolve(new Response("response body"));
    })
  );
  try {
    const response = await bridge.fetch(
      new Request("https://example.com"),
      cancellationStream(caller.signal)
    );
    expect(outgoing.aborted).toBe(false);
    expect(await response.text()).toBe("response body");
    caller.abort();
    await Promise.resolve();
    expect(outgoing.aborted).toBe(true);
  } finally {
    controller.abort();
    vi.unstubAllGlobals();
  }
});

it("validates redirect destinations before forwarding", async () => {
  const { bridge, controller } = setup();
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(null, {
        headers: { location: "https://127.0.0.1/private" },
        status: 302,
      })
    )
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      bridge.fetch(
        new Request("https://example.com"),
        cancellationStream(new AbortController().signal)
      )
    ).rejects.toThrow("public HTTPS");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    controller.abort();
    vi.unstubAllGlobals();
  }
});

it.each(["manual", "error"] as const)(
  "respects redirect: %s",
  async (redirect) => {
    const { bridge, controller } = setup();
    const fetch = vi.fn(
      async () =>
        await new Response(null, {
          headers: { location: "https://example.com/final" },
          status: 302,
        })
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const response = bridge.fetch(
        new Request("https://example.com/start", { redirect }),
        cancellationStream(new AbortController().signal)
      );
      if (redirect === "manual") {
        const awaitedResult1 = await response;
        expect(awaitedResult1.status).toBe(302);
      } else {
        await expect(response).rejects.toThrow("redirect");
      }
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
      vi.unstubAllGlobals();
    }
  }
);
