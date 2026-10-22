import { describe, expect, it, vi } from "vite-plus/test";

import { createSseClient } from "../src/client/core/serverSentEvents.gen";

describe("generated SSE cancellation", () => {
  it("handles a body that rejects cancellation when the connection closes", async () => {
    const controller = new AbortController();

    const cancel = vi
      .fn()
      .mockRejectedValue(new DOMException("Connection closed", "AbortError"));

    const { stream } = createSseClient({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            cancel,
            start(output) {
              output.enqueue(
                new TextEncoder().encode('data: {"type":"start"}\n\n')
              );
            },
          })
        )
      ),
      method: "POST",
      signal: controller.signal,
      sseMaxRetryAttempts: 1,
      url: "https://platform.test/app-agent/chat",
    });

    expect(await stream.next()).toMatchObject({ value: { type: "start" } });
    controller.abort();
    expect(await stream.next()).toMatchObject({ done: true });
    // Let rejected cancellation promises settle; the test runner detects any
    // unhandled rejection rather than merely checking the generated source.
    await (async () => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers();

      try {
        setTimeout(resolve, 0);
      } catch (error) {
        rejectPending(error);
      }

      return await pendingPromise;
    })();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
