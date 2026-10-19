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

        const { createTailorKitUploadManifest, tailorkitUploadManifestSchema } =
          await import("@tailorkit/vite/upload-manifest");
        const manifest = createTailorKitUploadManifest(undefined, true);
        assert.equal(manifest.assets.server, "server/server.js");
        assert.deepEqual(v.parse(tailorkitUploadManifestSchema, manifest), manifest);
        assert.equal(v.safeParse(tailorkitUploadManifestSchema, {
          assets: { client: "../../secret" }, version: 1,
        }).success, false);
        console.log("manifest runtime ready");
      `,
    ],
    { cwd: packageRoot, encoding: "utf-8" }
  );
  expect(output).toContain("manifest runtime ready");
});

it("links app config without native addons, build tooling, or executing app source", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--no-addons",
      "--input-type=module",
      "--eval",
      `
        import assert from "node:assert/strict";
        import { registerHooks } from "node:module";

        registerHooks({
          resolve(specifier, context, nextResolve) {
            if (/^(?:(?:vite|vite-plus|rolldown|oxc-parser)(?:$|\\/)|@voidzero-dev\\/)/u.test(specifier)) {
              throw new Error("Build tooling imported by app linking: " + specifier);
            }
            return nextResolve(specifier, context);
          },
        });

        const { setConfigAppId } = await import("@tailorkit/vite/config/app-link");
        const source = 'import { defineConfig } from "unavailable-app-module";\\n' +
          'throw new Error("App source must never execute on the host");\\n' +
          'export default defineConfig({ name: "My App", appId: "stale" }) satisfies Config;\\n';
        const linked = await setConfigAppId(source, "authorized-app", "tailorkit.config.ts");
        assert.equal(linked, source.replace('appId: "stale"', 'appId: "authorized-app"'));
        assert.equal(await setConfigAppId(linked, "authorized-app", "tailorkit.config.ts"), linked);
        console.log("app linking runtime ready");
      `,
    ],
    { cwd: packageRoot, encoding: "utf-8" }
  );
  expect(output).toContain("app linking runtime ready");
});
