import { expect, it, vi } from "vite-plus/test";

import { createIframeTools } from "./tools";

const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "app",
  projectId: "project",
  scope: { name: "workspace", value: { id: "workspace" } },
  subjectId: "principal",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

it("correlates client calls and server credentials and rejects pending calls on destroy", async () => {
  const send = vi.fn<Parameters<typeof createIframeTools>[0]>();
  const tools = createIframeTools(send);
  const clientCall = tools.bridge.client("ui.open", { id: "customer" });
  const serverCall = tools.bridge.session("data.read");
  const [first] = require(send.mock.calls[0]);
  const [second] = require(send.mock.calls[1]);
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
      identity,
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
