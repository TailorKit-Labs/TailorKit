import { expect, it, vi } from "vite-plus/test";

import { createIframeTools } from "./tools";

it("correlates client calls and server credentials and rejects pending calls on destroy", async () => {
  const send = vi.fn();
  const tools = createIframeTools(send);
  const clientCall = tools.bridge.client("ui.open", { id: "customer" });
  const serverCall = tools.bridge.session("data.read");
  const first = send.mock.calls[0]![0];
  const second = send.mock.calls[1]![0];
  expect(first).toMatchObject({
    input: { id: "customer" },
    kind: "client",
    path: "ui.open",
  });
  tools.receive({ id: "unknown", output: "ignored" });
  tools.receive({
    id: second.id,
    output: {
      expiresAt: 1000,
      token: "tool-token",
      url: "https://product.test/tools",
    },
  });
  tools.receive({ id: first.id, output: "opened" });
  await expect(clientCall).resolves.toBe("opened");
  await expect(serverCall).resolves.toMatchObject({ token: "tool-token" });
  const abandoned = tools.bridge.client("ui.open", {});
  tools.close();
  await expect(abandoned).rejects.toThrow("Sandbox destroyed");
  await expect(tools.bridge.session("data.read")).rejects.toThrow(
    "Sandbox destroyed"
  );
});
