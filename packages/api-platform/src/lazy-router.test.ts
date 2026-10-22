import { openapi, OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { os } from "@orpc/server";
import type { AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { lazyOpenAPIRouter } from "./lazy-router";

const fixture = () => {
  const loaded: string[] = [];

  const load = <TRouter extends AnyRouter>(
    name: `/${string}`,
    router: TRouter
  ) =>
    lazyOpenAPIRouter(name, async () => {
      loaded.push(name);

      return await Promise.resolve({ default: router });
    });

  const apps = os.meta(openapi({ path: "/apps/list" })).handler(() => "apps");

  const agent = os.meta(openapi({ prefix: "/app-agent" })).router({
    chat: os.meta(openapi({ path: "/chat" })).handler(() => "agent"),
  });

  const deployments = os
    .meta(openapi({ path: "/deployments/list" }))
    .handler(() => "deployments");

  const runtime = os
    .meta(openapi({ path: "/apps/{appId}/runtime" }))
    .input(z.object({ appId: z.string() }))
    .handler(() => "runtime");

  const router = {
    agent: load("/app-agent", agent),
    apps: load("/apps", { list: apps }),
    deployments: {
      list: load("/deployments", deployments),
      runtime: load("/apps", runtime),
    },
  };

  return { loaded, router };
};

const request = (path: string) =>
  new Request(`https://platform.test/api/platform${path}`, {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

const options = { prefix: "/api/platform" } satisfies { prefix: `/${string}` };

it("defers loaders until a request matches their OpenAPI prefix", async () => {
  const { loaded, router } = fixture();
  const handler = new OpenAPIHandler(router);
  expect(loaded).toEqual([]);
  const unknown = await handler.handle(request("/unknown"), options);
  const otherPrefix = await handler.handle(request("/unrelated/list"), options);
  expect(unknown.matched).toBe(false);
  expect(otherPrefix.matched).toBe(false);
  expect(loaded).toEqual([]);

  const { response } = await handler.handle(
    request("/deployments/list"),
    options
  );

  expect(response?.status).toBe(200);
  expect(await response?.json()).toBe("deployments");
  expect(loaded.every((prefix) => prefix === "/deployments")).toBe(true);
  expect(loaded.length).toBeGreaterThan(0);
});

it("preserves existing prefixes instead of prepending them twice", async () => {
  const { loaded, router } = fixture();
  const handler = new OpenAPIHandler(router);

  const { response } = await handler.handle(
    request("/app-agent/chat"),
    options
  );

  expect(response?.status).toBe(200);
  expect(await response?.json()).toBe("agent");
  expect(loaded.every((prefix) => prefix === "/app-agent")).toBe(true);
});

it("routes runtime requests under /apps without loading deployment operations", async () => {
  const { loaded, router } = fixture();
  const handler = new OpenAPIHandler(router);

  const { response } = await handler.handle(
    request("/apps/example/runtime"),
    options
  );

  expect(response?.status).toBe(200);
  expect(await response?.json()).toBe("runtime");
  expect(loaded.every((prefix) => prefix === "/apps")).toBe(true);
});

it("keeps generated OpenAPI paths and operation IDs unchanged", async () => {
  const { router } = fixture();

  const spec = await new OpenAPIGenerator({
    converters: [new ZodToJsonSchemaConverter()],
  }).generate(router, { base: { info: { title: "Fixture", version: "1" } } });

  expect(Object.keys(spec.paths ?? {}).toSorted()).toEqual([
    "/app-agent/chat",
    "/apps/list",
    "/apps/{appId}/runtime",
    "/deployments/list",
  ]);
  expect(spec.paths?.["/apps/{appId}/runtime"]?.post?.operationId).toBe(
    "deployments.runtime"
  );
});
