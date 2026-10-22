import { asyncFixture } from "@patchsmith/config/testing";
import { expect, it } from "vite-plus/test";

import { ViewResolutionTimings } from "./view-timing";

it("keeps runtime phase maxima and session timing without forwarding arbitrary headers", async () => {
  let now = 0;
  let calls = 0;

  const timings = new ViewResolutionTimings(
    asyncFixture(() => {
      calls += 1;
      now += 20;

      return new Response("unchanged", {
        headers: {
          "server-timing": `runtime_execute;dur=${calls * 3}, runtime_metadata;dur=2.0, secret;desc=private, runtime_unknown;dur=3, runtime_bundle;dur=999999, runtime_auth;dur=NaN`,
        },
      });
    }),
    () => now
  );

  expect(
    await timings.session(
      asyncFixture(() => {
        now += 5;

        return "session";
      })
    )
  ).toBe("session");
  const response = await timings.fetch("https://runtime.test");
  expect(await response.text()).toBe("unchanged");
  await timings.fetch("https://runtime.test");
  expect(timings.header()).toBe(
    "views_session_max;dur=5.0, runtime_roundtrip_max;dur=20.0, runtime_execute_max;dur=6.0, runtime_metadata_max;dur=2.0"
  );
  expect(new ViewResolutionTimings().header()).toBe("");
});
