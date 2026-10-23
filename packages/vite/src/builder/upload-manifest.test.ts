import * as v from "valibot";
import { expect, it } from "vite-plus/test";

import {
  createPatchsmithUploadManifest,
  patchsmithUploadManifestSchema,
} from "./upload-manifest";

it("defaults older manifests to no hooks and retains dotted hook names", () => {
  expect(
    v.parse(patchsmithUploadManifestSchema, {
      assets: { client: "client/client.js" },
      version: 1,
    }).hooks
  ).toEqual([]);
  expect(
    createPatchsmithUploadManifest(undefined, true, undefined, undefined, [
      "sync",
      "billing.updated",
    ]).hooks
  ).toEqual(["sync", "billing.updated"]);
});

it.each([
  ["sync", "sync"],
  ["bad/name"],
  ["a..b"],
  ["a.constructor"],
  [""],
  Array.from({ length: 1001 }, (_, index) => `hook${index}`),
])("rejects invalid hook names or duplicate registrations: %j", (...hooks) => {
  expect(
    v.safeParse(patchsmithUploadManifestSchema, {
      assets: { client: "client/client.js" },
      hooks,
      version: 1,
    }).success
  ).toBe(false);
});
