import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { createPatchsmithServer } from "./handler";

it("routes only resolution to the opt-in backend from an arbitrary host", async () => {
  const requests: Request[] = [];

  const platformFetch: typeof fetch = asyncFixture((value, init) => {
    const request = value instanceof Request ? value : new Request(value, init);
    requests.push(request);

    return new URL(request.url).pathname.endsWith("/apps/list")
      ? Response.json({ items: [], pagination: { hasMore: false } })
      : Response.json({ data: [], status: "ready", warnings: [] });
  });

  const server = createPatchsmithServer({
    $internal: {
      platformBaseUrl: "https://platform.test/api/platform",
      platformFetch,
      runtimeResolveBaseUrl: "https://views.test/api/platform",
    },
    baseUrl: "https://any-host.test/api/patchsmith",
    components: {},
    projectKey: "server-only-key",
    scopes: { workspace: z.object({ id: z.string() }) },
    slots: {
      sidebar: { multiple: true, views: ["/"] },
      single: { views: ["/"] },
    },
    views: { "/": z.object({ viewer: z.string() }) },
  });

  const run = async (slot: string) => {
    const response = await server.handler(
      new Request("https://any-host.test/api/patchsmith/views", {
        body: JSON.stringify({
          activeView: {
            layers: [
              {
                context: { secret: "discard", viewer: "viewer" },
                path: "/",
                status: "ready",
              },
            ],
            view: "/",
          },
          slot,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      {
        authenticate: () => ({
          scopes: { workspace: { id: "authorized" } },
          subjectId: "verified-viewer",
        }),
      }
    );

    expect(response.status).toBe(200);
  };

  await run("sidebar");
  await run("single");

  expect(requests.map(({ url }) => url)).toEqual([
    "https://views.test/api/platform/apps/runtime/resolve",
    "https://platform.test/api/platform/apps/list",
  ]);
  expect(requests[0]?.redirect).toBe("error");
  expect(requests[0]?.headers.get("authorization")).toBe(
    "Bearer server-only-key"
  );
  expect(await requests[0]?.json()).toMatchObject({
    contexts: [{ context: { viewer: "viewer" }, path: "/", status: "ready" }],
    scopes: [{ name: "workspace", value: { id: "authorized" } }],
    subjectId: "verified-viewer",
    toolUrl: "https://any-host.test/api/patchsmith/tools/execute",
  });
});
