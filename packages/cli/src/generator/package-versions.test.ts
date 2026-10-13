import { afterEach, expect, it, vi } from "vite-plus/test";

import { resolveTemplatePackageVersions } from "./package-versions";

afterEach(() => vi.unstubAllGlobals());

it("resolves only stable Preact 11 releases from the registry", async () => {
  vi.stubGlobal(
    "fetch",
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    vi.fn(async () => ({
      json: async () =>
        await {
          versions: {
            "10.99.0": {},
            "11.0.0": {},
            "11.1.0": {},
            "11.2.0-beta.1": {},
            "12.0.0": {},
          },
        },
      ok: true,
    }))
  );
  const awaitedResult1 = await resolveTemplatePackageVersions();
  expect(awaitedResult1.preact).toBe("^11.1.0");
});

it("falls back to Preact 11 when the registry is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const awaitedResult2 = await resolveTemplatePackageVersions();
  expect(awaitedResult2.preact).toBe("^11.0.0");
});
