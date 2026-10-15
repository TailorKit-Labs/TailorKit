import type { ToolImplementations } from "@tailorkit/core/schema";
import { defineContract, tool } from "@tailorkit/core/schema";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { TailorKitApp } from "#types";

import { createEndpointClient } from "./endpoints";

const app: TailorKitApp = { id: "installed-app" };
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
  const implementation = vi.fn<
    ToolImplementations<typeof contract.tools, "client">["ui"]["select"]
  >(({ input }) => input + 1);
  const bodies: unknown[] = [];
  const client = createEndpointClient({
    baseUrl: "https://product.test/api/tailorkit/",
    contract,

    fetch: async (_url, options) => {
      bodies.push(await new Response(options?.body).json());
      return Response.json({
        expiresAt: identity.expiresAt,
        identity,
        subjectId: identity.subjectId,
        token: "verified-token",
        toolUrl: identity.toolUrl,
        url: "https://runtime.test/rpc",
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
  // oxlint-disable-next-line unicorn/no-useless-undefined -- The bridge input argument is required.
  await expect(bridge.client("data.read", undefined)).rejects.toThrow(
    "Not a client tool"
  );
  await expect(bridge.client("ui.select", 1)).rejects.toThrow(
    "Invalid tool payload"
  );
  // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
  implementation.mockImplementation(() => "invalid" as never);
  await expect(bridge.client("ui.select", "test")).rejects.toThrow(
    "Invalid tool payload"
  );
});
it("discards a pending credential when the session cache is cleared", async () => {
  let complete!: (response: Response) => void;
  const client = createEndpointClient({
    baseUrl: "https://product.test/api/tailorkit/",
    contract,
    fetch: async () =>
      await (async () => {
        const {
          promise: pendingPromise,
          resolve,
          reject: rejectPending,
        } = Promise.withResolvers<Response>();
        try {
          complete = resolve;
        } catch (error) {
          rejectPending(error);
        }
        return await pendingPromise;
      })(),
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
