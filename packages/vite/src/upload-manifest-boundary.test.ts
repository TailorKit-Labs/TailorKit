import { execFileSync } from "node:child_process";
import path from "node:path";

import { beforeAll, expect, it } from "vite-plus/test";

const packageRoot = path.resolve(import.meta.dirname, "..");

beforeAll(() => {
  execFileSync("pnpm", ["run", "build"], {
    cwd: packageRoot,
    timeout: 60_000,
  });
}, 60_000);

it("validates upload manifests without loading build tooling in a server runtime", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import * as v from "valibot";
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

        const { createPatchsmithUploadManifest, patchsmithUploadManifestSchema } =
          await import("@patchsmith/vite/upload-manifest");
        const manifest = createPatchsmithUploadManifest(undefined, true);
        assert.equal(manifest.assets.server, "server/server.js");
        assert.deepEqual(v.parse(patchsmithUploadManifestSchema, manifest), manifest);
        assert.equal(v.safeParse(patchsmithUploadManifestSchema, {
          assets: { client: "../../secret" }, version: 1,
        }).success, false);
        console.log("manifest runtime ready");
      `,
    ],
    { cwd: packageRoot, encoding: "utf-8" }
  );
  expect(output).toContain("manifest runtime ready");
});
