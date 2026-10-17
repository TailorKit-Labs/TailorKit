import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { createClient } from "../src/client/client/index";
import { appsDelete, appsGet, appsUpdate } from "../src/client/sdk.gen";

const scope = { name: "environment", value: { environment: "production" } };

it("serializes explicit app namespaces through the generated client", async () => {
  const requests: Request[] = [];
  const client = createClient({
    baseUrl: "https://platform.test/api/platform",
    // oxlint-disable-next-line eslint/require-await -- This in-memory transport records the real generated SDK requests.
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({});
    },
  });
  for (const app of [
    { id: "11111111-1111-4111-8111-111111111111" },
    { shortId: "app000000001" },
    { slug: "shared-inbox" },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Inspect each generated request in selector order.
    await appsGet({ body: { app, scopes: [scope] }, client });
  }
  await appsUpdate({
    body: {
      app: { slug: "shared-inbox" },
      description: null,
      name: "Renamed inbox",
      scope,
    },
    client,
  });
  await appsDelete({ body: { app: { slug: "shared-inbox" }, scope }, client });
  expect(requests.map(({ url, method }) => ({ method, url }))).toEqual([
    ...Array.from({ length: 3 }, () => ({
      method: "POST",
      url: "https://platform.test/api/platform/apps/lookup",
    })),
    { method: "POST", url: "https://platform.test/api/platform/apps/update" },
    { method: "POST", url: "https://platform.test/api/platform/apps/delete" },
  ]);
  const bodies = await Promise.all(
    requests.map(async (request) => z.json().parse(await request.json()))
  );
  expect(bodies).toEqual([
    { app: { id: "11111111-1111-4111-8111-111111111111" }, scopes: [scope] },
    { app: { shortId: "app000000001" }, scopes: [scope] },
    { app: { slug: "shared-inbox" }, scopes: [scope] },
    {
      app: { slug: "shared-inbox" },
      description: null,
      name: "Renamed inbox",
      scope,
    },
    { app: { slug: "shared-inbox" }, scope },
  ]);
});
