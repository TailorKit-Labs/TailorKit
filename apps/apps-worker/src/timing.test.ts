import { asyncFixture } from "@patchsmith/config/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import { RuntimeTimings } from "./timing";

it("records failed work and preserves response status, body and existing timings", async () => {
  let now = 10;
  const timings = new RuntimeTimings(() => now);

  const operation = timings.measure(
    "runtime_metadata",
    Effect.suspend(() => {
      now = 25;

      return Effect.fail({ _tag: "Unavailable" as const });
    })
  );

  const exit = await Effect.runPromiseExit(operation);
  expect(exit._tag).toBe("Failure");

  const response = timings.response(
    new Response("failure", {
      headers: { "server-timing": "existing;dur=2.0" },
      status: 503,
    })
  );

  expect(response.status).toBe(503);
  expect(await response.text()).toBe("failure");
  expect(response.headers.get("server-timing")).toBe(
    "existing;dur=2.0, runtime_metadata;dur=15.0"
  );
  expect(
    new RuntimeTimings().response(new Response()).headers.has("server-timing")
  ).toBe(false);
});

it("times async failures without changing their error", async () => {
  let now = 0;
  const timings = new RuntimeTimings(() => now);
  const error = new Error("KV unavailable");

  await expect(
    timings.time(
      "runtime_metadata_kv",
      asyncFixture(() => {
        now = 12;
        throw error;
      })
    )
  ).rejects.toBe(error);
  expect(timings.response(new Response()).headers.get("server-timing")).toBe(
    "runtime_metadata_kv;dur=12.0"
  );
});
