import { describe, expect, it } from "vite-plus/test";

import { getSameOriginPath, getSameOriginUrl } from "./safe-return-url";

const ORIGIN = "https://patchsmith.io";

describe("getSameOriginPath", () => {
  it("returns only the path, search, and hash for same-origin URLs", () => {
    expect(
      getSameOriginPath("https://patchsmith.io/apps?tab=usage#details", ORIGIN)
    ).toBe("/apps?tab=usage#details");
    expect(getSameOriginPath("/apps?tab=usage#details", ORIGIN)).toBe(
      "/apps?tab=usage#details"
    );
  });

  it("rejects cross-origin and malformed URLs", () => {
    expect(
      getSameOriginPath("https://attacker.example/apps", ORIGIN)
    ).toBeUndefined();
    expect(
      getSameOriginPath("//attacker.example/apps", ORIGIN)
    ).toBeUndefined();
    expect(getSameOriginPath("https://%", ORIGIN)).toBeUndefined();
  });

  it("returns an absolute same-origin URL for auth callbacks", () => {
    expect(getSameOriginUrl("/patchsmith/~/projects", ORIGIN)).toBe(
      "https://patchsmith.io/patchsmith/~/projects"
    );
    expect(
      getSameOriginUrl("https://attacker.example/apps", ORIGIN)
    ).toBeUndefined();
  });
});
