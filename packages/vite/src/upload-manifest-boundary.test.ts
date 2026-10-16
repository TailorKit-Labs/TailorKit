import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vite-plus/test";

it("validates upload manifests without loading build tooling in a server runtime", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import assert from "node:assert/strict";
        import { registerHooks } from "node:module";

        registerHooks({
          resolve(specifier, context, nextResolve) {
            if (/^(?:(?:vite|vite-plus|rolldown|cosmiconfig)(?:$|\\/)|@voidzero-dev\\/)/u.test(specifier)) {
              throw new Error("Build tooling imported by manifest validation: " + specifier);
            }
            return nextResolve(specifier, context);
          },
        });

        const { createTailorKitUploadManifest, tailorkitUploadManifestSchema } =
          await import("@tailorkit/vite/upload-manifest");
        const manifest = createTailorKitUploadManifest(undefined, true);
        assert.equal(manifest.assets.server, "server/server.js");
        assert.deepEqual(tailorkitUploadManifestSchema.parse(manifest), manifest);
        assert.equal(tailorkitUploadManifestSchema.safeParse({
          assets: { client: "../../secret" }, version: 1,
        }).success, false);
        console.log("manifest runtime ready");
      `,
    ],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf-8" }
  );
  expect(output).toContain("manifest runtime ready");
});
