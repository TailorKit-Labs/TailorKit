import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vite-plus/test";

import { readClientManifest, readClientViews } from "./client-views";

it("reads actual slot declarations, including computed paths, and excludes disabled views", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "patchsmith-client-views-"));
  const filename = path.join(root, "client.js");

  try {
    await writeFile(
      filename,
      `const path = "/detail"; export default { slots: { page: { "/": { component() {} }, [path]: false }, panel: { [path]: { component() {} } } } };`
    );
    expect(await readClientViews(filename)).toEqual([
      { path: "/", slot: "page" },
      { path: "/detail", slot: "panel" },
    ]);
    await writeFile(
      filename,
      "export default { slots: { page: { invalid: {} } } };"
    );
    await expect(readClientViews(filename)).rejects.toThrow(
      "Unable to read app views"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("preserves instance availability and registrations when one view is used in multiple slots", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "patchsmith-instance-manifest-")
  );

  const filename = path.join(root, "client.js");
  const resolver = "i0123456789abcdef01234567";

  try {
    await writeFile(
      filename,
      `const view = { instances: { resolver: "${resolver}" } }; export default { slots: { "page.links": { "/reports/annual.summary": view }, panel: { "/": view, "/disabled": false } } };`
    );
    const manifest = await readClientManifest(filename);
    expect(manifest.views).toEqual([
      { instances: true, path: "/reports/annual.summary", slot: "page.links" },
      { instances: true, path: "/", slot: "panel" },
      { disabled: true, path: "/disabled", slot: "panel" },
    ]);
    expect(manifest.instanceResolvers).toEqual([
      { path: "/reports/annual.summary", resolver, slot: "page.links" },
      { path: "/", resolver, slot: "panel" },
    ]);
    expect(JSON.stringify(manifest.views)).not.toContain(resolver);
    await writeFile(
      filename,
      `export default { slots: { page: { "/": { instances: { resolver: "invalid" } } } } };`
    );
    await expect(readClientManifest(filename)).rejects.toThrow(
      "Unable to read app views"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
