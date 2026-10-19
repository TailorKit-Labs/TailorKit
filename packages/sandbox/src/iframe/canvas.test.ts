import { expect, it, vi } from "vite-plus/test";

import { createIframeCanvases } from "./canvas";

it("observes host registration generations, ignores duplicates, and releases subscriptions", () => {
  const bridge = createIframeCanvases(() => {
    throw new Error("No canvas request expected.");
  });
  const generations: (string | null)[] = [];
  bridge.availability("surface", "first");
  const unsubscribe = bridge.watch("surface", (generation) => {
    generations.push(generation);
  });
  bridge.availability("surface", "first");
  bridge.availability("surface", null);
  bridge.availability("surface", "resized");
  expect(generations).toEqual(["first", null, "resized"]);
  unsubscribe();
  bridge.availability("surface", "unobserved");
  bridge.close();
  expect(generations).toEqual(["first", null, "resized"]);
});

it("rejects denied grants, bounds outstanding requests, and rejects them on teardown", async () => {
  const requests: { id: string; name: string }[] = [];
  const bridge = createIframeCanvases((request) => {
    requests.push(request);
  });
  const denied = bridge.request("missing");
  const [first] = requests;
  if (!first) {
    throw new Error("Missing request.");
  }
  bridge.receive({ error: "Not registered", id: first.id });
  await expect(denied).rejects.toThrow("Not registered");
  const pending = Array.from(
    { length: 8 },
    async () => await bridge.request("surface")
  );
  const rejected = pending.map(async (request) => {
    await expect(request).rejects.toThrow("destroyed");
  });
  await expect(bridge.request("overflow")).rejects.toThrow("unavailable");
  bridge.close();
  await Promise.all(rejected);
  await expect(bridge.request("closed")).rejects.toThrow("unavailable");
});

it("rejects malformed successful grants without exposing a surface", async () => {
  let requestId = "";
  const bridge = createIframeCanvases(({ id }) => {
    requestId = id;
  });
  const pending = bridge.request("surface");
  bridge.receive({ height: 200, id: requestId, width: 320 });
  await expect(pending).rejects.toThrow("unavailable");
  bridge.close();
});

it("cleans up a request when the transport fails", async () => {
  const bridge = createIframeCanvases(() => {
    throw new Error("Transport failed");
  });
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      await expect(bridge.request("surface")).rejects.toThrow(
        "Transport failed"
      );
    })
  );
  bridge.close();
});

it("expires a request and closes a late transferred port", async () => {
  vi.useFakeTimers();
  let requestId = "";
  const bridge = createIframeCanvases(({ id }) => {
    requestId = id;
  });
  const { port1, port2 } = new MessageChannel();
  try {
    const pending = bridge.request("surface");
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    const { promise: received, resolve } =
      Promise.withResolvers<MessageEvent<unknown>>();
    port1.addEventListener("message", resolve, { once: true });
    port1.start();
    bridge.receive({ height: 200, id: requestId, port: port2, width: 320 });
    const { data } = await received;
    expect(data).toEqual({ type: "close" });
  } finally {
    bridge.close();
    port1.close();
    port2.close();
    vi.useRealTimers();
  }
});

it("negotiates native input only for SDK requests that opt in", async () => {
  const requests: { id: string; input?: boolean }[] = [];
  const bridge = createIframeCanvases((request) => {
    requests.push(request);
  });
  const legacy = bridge.request("legacy");
  const native = bridge.request("native", "generation", true);
  const denied = Promise.all([
    expect(legacy).rejects.toThrow("destroyed"),
    expect(native).rejects.toThrow("destroyed"),
  ]);
  expect(requests.map(({ input }) => input)).toEqual([false, true]);
  bridge.close();
  await denied;
});
