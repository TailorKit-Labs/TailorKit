import { asyncFixture } from "@patchsmith/config/testing";
import { viewsInputSchema } from "@patchsmith/core/views";
import * as v from "valibot";
import { expect, it, vi } from "vite-plus/test";

import { createPatchsmithStore } from "#store/store";
import { testContract } from "#test-contract";

import { createPatchsmithFetchClient } from "./fetch-client";
import { refetchViews } from "./views";

it("refreshes host discovery and instances with the latest context", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      asyncFixture(() => Response.json({ data: [], status: "ready" }))
    );

  const client = createPatchsmithFetchClient({
    baseUrl: "https://host.test/",
    fetch,
  });

  const store = createPatchsmithStore({
    baseUrl: client.baseUrl,
    client,
    contract: testContract(true),
  });

  const id = Symbol("view");

  for (const customer of ["first", "second"]) {
    store.views.register({ context: { customer }, id, view: "/" });
    // oxlint-disable-next-line no-await-in-loop -- Each refresh must observe the preceding context registration.
    await Promise.resolve();
    // oxlint-disable-next-line no-await-in-loop -- Verify sequential refreshes use the latest context.
    await refetchViews(store, {
      appIds: ["app"],
      scopes: ["user"],
      slot: "page",
    });
  }

  expect(
    await Promise.all(
      fetch.mock.calls.map(async ([, init]) =>
        v.parse(viewsInputSchema, await new Response(init?.body).json())
      )
    )
  ).toEqual(
    ["first", "second"].map((customer) => ({
      activeView: {
        layers: [{ context: { customer }, path: "/", status: "ready" }],
        view: "/",
      },
      appIds: ["app"],
      scopes: ["user"],
      slot: "page",
    }))
  );
  store.views.unregister(id);
});
