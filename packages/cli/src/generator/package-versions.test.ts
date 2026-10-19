import { afterEach, expect, it, vi } from "vite-plus/test";

import { resolveTemplatePackageVersions } from "./package-versions";

afterEach(() => vi.unstubAllGlobals());

it("resolves only stable Preact 11 releases from the registry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        time: {
          "11.0.0": "2026-01-01",
          "11.1.0": "2026-01-02",
          "12.0.0": "2026-01-03",
        },
        versions: {
          "10.99.0": {},
          "11.0.0": {},
          "11.1.0": {},
          "11.2.0-beta.1": {},
          "12.0.0": {},
        },
      }),
      ok: true,
    })
  );
  const awaitedResult1 = await resolveTemplatePackageVersions();
  expect(awaitedResult1.preact).toBe("11.1.0");
});

it("falls back to Preact 11 when the registry is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const awaitedResult2 = await resolveTemplatePackageVersions();
  expect(awaitedResult2.preact).toBe("11.0.0");
  expect(awaitedResult2.valibot).toBe("1.5.0");
});

it("skips releases younger than three days", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        time: { "8.0.0": "2026-01-01", "8.1.0": new Date().toISOString() },
        versions: { "8.0.0": {}, "8.1.0": {} },
      }),
      ok: true,
    })
  );
  const awaitedResult3 = await resolveTemplatePackageVersions("vite");
  expect(awaitedResult3.vite).toBe("8.0.0");
});

it("scaffolds against the CLI's SDK version", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const { default: packageJson } = await import("#package.json", {
    with: { type: "json" },
  });
  const awaitedResult4 = await resolveTemplatePackageVersions();
  expect(awaitedResult4.patchsmith).toBe(packageJson.version);
});

it("selects stable Valibot 1 releases that satisfy the release-age policy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        time: {
          "1.5.0": "2026-01-01",
          "1.6.0": "2026-01-02",
          "1.7.0": new Date().toISOString(),
          "1.8.0-beta.1": "2026-01-03",
          "2.0.0": "2026-01-03",
        },
        versions: {
          "1.5.0": {},
          "1.6.0": {},
          "1.7.0": {},
          "1.8.0-beta.1": {},
          "2.0.0": {},
        },
      }),
      ok: true,
    })
  );
  const versions = await resolveTemplatePackageVersions();
  expect(versions.valibot).toBe("1.6.0");
});
