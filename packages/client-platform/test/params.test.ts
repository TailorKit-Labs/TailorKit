import { describe, expect, it } from "vite-plus/test";

import { buildClientParams } from "../src/client/core/params.gen";

describe("buildClientParams", () => {
  it("rejects mapped body fields after a raw body", () => {
    expect(() =>
      buildClientParams(
        [null, { $body_name: "PatchSmith" }],
        [{ in: "body" }, { allowExtra: { body: true } }]
      )
    ).toThrow("Cannot mix raw and mapped body parameters.");
  });

  it("rejects a raw body after mapped body fields", () => {
    expect(() =>
      buildClientParams(
        [{ $body_name: "PatchSmith" }, null],
        [{ allowExtra: { body: true } }, { in: "body" }]
      )
    ).toThrow("Cannot mix raw and mapped body parameters.");
  });

  it("preserves exclusively raw and exclusively mapped bodies", () => {
    expect(buildClientParams([null], [{ in: "body" }]).body).toBeNull();
    expect(
      buildClientParams(
        [{ $body_name: "PatchSmith" }],
        [{ allowExtra: { body: true } }]
      ).body
    ).toEqual({ name: "PatchSmith" });
  });
});
