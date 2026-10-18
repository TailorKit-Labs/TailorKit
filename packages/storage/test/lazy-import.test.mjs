import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

for (const entry of ["index", "s3"]) {
  for (const configured of ["configured", "unconfigured"]) {
    void test(`${entry} defers S3 dependencies with ${configured} storage`, () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("fixtures/lazy-import.mjs", import.meta.url)),
          entry,
          configured,
        ],
        {
          encoding: "utf-8",
          env: {
            BLOB_ACCESS_KEY_ID: "test",
            BLOB_BUCKET: configured === "configured" ? "test" : "",
            BLOB_ENDPOINT: "https://example.r2.cloudflarestorage.com",
            BLOB_SECRET_ACCESS_KEY: "test",
            NODE_ENV: "test",
          },
          timeout: 30_000,
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    });
  }
}
