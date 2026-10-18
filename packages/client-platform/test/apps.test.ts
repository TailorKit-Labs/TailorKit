import { asyncFixture } from "@tailorkit/config/testing";
import * as v from "valibot";
import { expect, it } from "vite-plus/test";

import { agentCreateAppSchema } from "../src/agent";
import { createClient } from "../src/client/client/index";
import { appsDelete, appsGet, appsUpdate } from "../src/client/sdk.gen";

const scope = { name: "environment", value: { environment: "production" } };

it.each([
  { id: "11111111-1111-4111-8111-111111111111" },
  { shortId: "app000000001" },
  { slug: "shared-inbox" },
])("serializes app namespace %j through the generated client", async (app) => {
  const requests: Request[] = [];
  const client = createClient({
    baseUrl: "https://platform.test/api/platform",
    fetch: asyncFixture((input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({});
    }),
  });
  await appsGet({ body: { app, scopes: [scope] }, client });
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
    { method: "POST", url: "https://platform.test/api/platform/apps/lookup" },
    { method: "POST", url: "https://platform.test/api/platform/apps/update" },
    { method: "POST", url: "https://platform.test/api/platform/apps/delete" },
  ]);
  const bodies = await Promise.all(
    requests.map(async (request) => v.parse(v.unknown(), await request.json()))
  );
  expect(bodies).toEqual([
    { app, scopes: [scope] },
    {
      app: { slug: "shared-inbox" },
      description: null,
      name: "Renamed inbox",
      scope,
    },
    { app: { slug: "shared-inbox" }, scope },
  ]);
});

it("limits agent app slugs to 32 characters", () => {
  const input = { description: null, name: "Inbox", slug: "a".repeat(32) };
  expect(v.parse(agentCreateAppSchema, input).slug).toBe(input.slug);
  expect(
    v.safeParse(agentCreateAppSchema, { ...input, slug: "a".repeat(33) })
      .success
  ).toBe(false);
});
