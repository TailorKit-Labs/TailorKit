import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { appContract } from "@patchsmith/app/protocol";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineContract } from "#schema/contract";
import { hook } from "#schema/hooks";

import { createServer } from "./contract";

const context = { scopes: { team: { id: "team" } }, subjectId: "service:sync" };

type HookFixtureResult = HookFixtureOutput | number | undefined;

interface HookFixtureOutput {
  processed: number | string;
}

const fixture = () => {
  const platformBodies: { path: string; body: unknown }[] = [];
  const invocations: unknown[] = [];
  let output: HookFixtureResult = { processed: 3 };
  const base = implement(appContract);

  const handler = new RPCHandler({
    actions: base.actions.handler(({ input }) => {
      invocations.push(input);

      return { output };
    }),
    queries: base.queries.handler(() => {
      throw new Error("Discovery must not call app runtimes");
    }),
  });

  const server = createServer({
    $internal: {
      platformFetch: async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        const body: unknown = await request.json();
        platformBodies.push({ body, path });
        expect(request.headers.get("authorization")).toBe("Bearer project-key");

        if (path.endsWith("/apps/list")) {
          return Response.json({
            items: [
              {
                currentDeployment: { hooks: ["sync"], id: "deployment" },
                id: "app",
              },
              { currentDeployment: null, id: "draft" },
              { currentDeployment: { hooks: [], id: "empty" }, id: "no-hooks" },
              {
                currentDeployment: { hooks: ["other"], id: "other" },
                id: "other-hooks",
              },
            ],
            pagination: { hasMore: false },
          });
        }

        const parsed = z.object({ hook: z.string().optional() }).parse(body);

        return Response.json({
          expiresAt: Date.now() + 300_000,
          identity: {
            appId: "app",
            deploymentId: "deployment",
            expiresAt: Date.now() + 300_000,
            hook: parsed.hook,
            installationId: "app",
            projectId: "project",
            scope: { name: "team", value: { id: "team" } },
            subjectId: context.subjectId,
            toolUrl: "https://host.test/api/patchsmith/tools/execute",
          },
          token:
            parsed.hook === undefined ? "ordinary-session" : "hook-session",
          url: "https://runtime.test/rpc",
        });
      },
      runtimeFetch: async (input, init) => {
        const request = new Request(input, init);
        const token = request.headers.get("authorization");
        expect(
          token === "Bearer hook-session" || token === "Bearer ordinary-session"
        ).toBe(true);
        const result = await handler.handle(request, { prefix: "/rpc" });

        if (!result.response) {
          throw new Error("Unmatched runtime request");
        }

        return result.response;
      },
    },
    baseUrl: "https://host.test/api/patchsmith",
    contract: defineContract({
      hooks: {
        notify: hook(),
        optional: hook()
          .input(z.string().optional())
          .output(z.number().optional()),
        sync: hook()
          .input(z.string().transform(Number).pipe(z.number()))
          .output(z.object({ processed: z.number() })),
      },
      scopes: { team: z.object({ id: z.string() }) },
    }),
    projectKey: "project-key",
  });

  return {
    invocations,
    platformBodies,
    server,
    setOutput: (value: HookFixtureResult) => {
      output = value;
    },
  };
};

it("invokes a hook through the real RPC transport with validated input and a host-scoped session", async () => {
  const { server, platformBodies, invocations } = fixture();
  expect(
    await server.hooks.sync.invoke({ appId: "app", ...context, input: "3" })
  ).toEqual({ processed: 3 });
  expect(platformBodies[0]?.body).toMatchObject({
    hook: "sync",
    scopes: [{ name: "team", value: { id: "team" } }],
    subjectId: "service:sync",
    toolUrl: "https://host.test/api/patchsmith/tools/execute",
  });
  expect(invocations).toEqual([
    { args: { hook: "sync", input: 3 }, name: "_patchsmith.hooks.invoke" },
  ]);
});

it("rejects invalid inputs, outputs and caller context", async () => {
  const { server, platformBodies, setOutput } = fixture();
  await expect(
    server.hooks.sync.invoke({ appId: "app", ...context, input: "invalid" })
  ).rejects.toThrow("Invalid input for hook");
  expect(platformBodies).toHaveLength(0);
  await expect(
    server.hooks.sync.invoke({
      appId: "app",
      ...context,
      input: "3",
      scopes: {},
    })
  ).rejects.toThrow("at least one scope");
  await expect(
    server.hooks.sync.invoke({
      appId: "app",
      ...context,
      input: "3",
      subjectId: "",
    })
  ).rejects.toThrow();
  expect(platformBodies).toHaveLength(0);
  setOutput({ processed: "wrong" });
  await expect(
    server.hooks.sync.invoke({ appId: "app", ...context, input: "3" })
  ).rejects.toThrow("Invalid output for hook");
});

it("discovers supported installed hooks without issuing an invocation grant", async () => {
  const { server, platformBodies, invocations } = fixture();
  expect(await server.hooks.sync.list(context)).toEqual([
    { currentDeployment: { hooks: ["sync"], id: "deployment" }, id: "app" },
  ]);
  expect(platformBodies).toHaveLength(1);
  expect(platformBodies[0]?.path).toMatch(/\/apps\/list$/u);
  expect(invocations).toEqual([]);
});

it("validates caller fields before discovering hooks", async () => {
  const { server, platformBodies } = fixture();
  await expect(
    server.hooks.sync.list({ ...context, scopes: {} })
  ).rejects.toThrow("at least one scope");
  await expect(
    server.hooks.sync.list({ ...context, subjectId: "" })
  ).rejects.toThrow();
  expect(platformBodies).toEqual([]);
});

it("rejects cancellation before requesting a session", async () => {
  const { server, platformBodies } = fixture();
  await expect(
    server.hooks.sync.invoke({
      appId: "app",
      ...context,
      input: "3",
      signal: AbortSignal.abort(),
    })
  ).rejects.toThrow();
  expect(platformBodies).toEqual([]);
});

it("preserves omitted input and output through hook transport", async () => {
  const { server, setOutput } = fixture();
  setOutput(undefined);
  await expect(
    server.hooks.notify.invoke({ appId: "app", ...context })
  ).resolves.toBeUndefined();
  expect(
    await server.hooks.optional.invoke({ appId: "app", ...context })
  ).toBeUndefined();
  setOutput(4);
  expect(
    await server.hooks.optional.invoke({
      appId: "app",
      ...context,
      input: "cursor",
    })
  ).toBe(4);
});
