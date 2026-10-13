import { defineContract, tool } from "@tailorkit/core/schema";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { TailorKitApp } from "../types";
import { createEndpointClient } from "./endpoints";

const app = { id: "installed-app" } as TailorKitApp;
const contract = defineContract({
  scopes: { workspace: z.object({ id: z.string() }) },
  tools: {
    data: { read: tool.server().output(z.number()) },
    ui: {
      select: tool
        .client()
        .input(z.string().transform((value) => value.length))
        .output(z.number()),
    },
  },
});
const identity = {
  appId: app.id,
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: app.id,
  projectId: "project",
  scope: { name: "workspace", value: { id: "workspace" } },
  subjectId: "job:refresh",
  toolUrl: "https://product.test/tools",
};
it("binds client tool calls to the installation and validates transformed inputs and outputs", async () => {
  const implementation = vi.fn(({ input }) => input + 1);
  const bodies: unknown[] = [];
  const client = createEndpointClient({
    baseUrl: "https://product.test/api/tailorkit/",
    contract,
    fetch: async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      return Response.json({
        subjectId: identity.subjectId,
        token: "verified-token",
        url: "https://runtime.test/rpc",
        toolUrl: identity.toolUrl,
        expiresAt: identity.expiresAt,
        identity,
      });
    },
    tools: { ui: { select: implementation } },
  });
  const bridge = client.getToolBridge(app);
  expect(await bridge.client("ui.select", "test")).toBe(5);
  const credential = await bridge.session("data.read");
  const backendSession = await client.getSessionProvider(app)({
    refresh: false,
  });
  expect(credential.token).toBe(backendSession.token);
  expect(credential.url).toBe(identity.toolUrl);
  expect(backendSession.url).toBe("https://runtime.test/rpc");
  expect(bodies).toEqual([{ appId: app.id }]);
  expect(
    Object.isFrozen(
      implementation.mock.calls[0]?.[0].context.identity.scope.value
    )
  ).toBe(true);
  expect(implementation.mock.calls[0]?.[0]).toMatchObject({
    context: { identity, scope: identity.scope },
    input: 4,
  });
  await expect(bridge.client("data.read")).rejects.toThrow("Not a client tool");
  await expect(bridge.client("ui.select", 1)).rejects.toThrow(
    "Invalid tool payload"
  );
  implementation.mockImplementation(() => "invalid" as unknown as number);
  await expect(bridge.client("ui.select", "test")).rejects.toThrow(
    "Invalid tool payload"
  );
});
it("discards a pending credential when the session cache is cleared", async () => {
  let complete!: (response: Response) => void;
  const client = createEndpointClient({
    baseUrl: "https://product.test/api/tailorkit/",
    contract,
    fetch: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const pending = client.getToolBridge(app).session("data.read");
  client.clearSessions();
  complete(
    Response.json({
      expiresAt: identity.expiresAt,
      identity,
      subjectId: identity.subjectId,
      token: "old-subject",
      toolUrl: identity.toolUrl,
      url: "https://runtime.test/rpc",
    })
  );
  await expect(pending).rejects.toThrow("The app session was invalidated");
});
