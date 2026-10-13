import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Isolate telemetry/env setup; exercise the real storage code and AWS signer.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@tailorkit/observability") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const withSpan = (_name, _options, run) => run();",
      };
    }
    return nextResolve(specifier, context);
  },
});
const { createS3CompatibleStorage } = await import("../src/s3.ts");
hooks.deregister();
const storage = createS3CompatibleStorage({
  accessKeyId: "test",
  bucket: "test",
  endpoint: "https://example.r2.cloudflarestorage.com",
  secretAccessKey: "test",
});

test("presigned upload signs the exact checksum and content-type headers returned to clients", async () => {
  const checksum = Buffer.alloc(32).toString("base64");
  const result = await storage.createUploadUrl({
    checksumSha256: checksum,
    contentType: "application/javascript",
    key: "assets/client.js",
    metadata: { fileId: "test-file" },
  });
  const url = new URL(result.uploadUrl);
  assert.equal(url.searchParams.has("x-amz-checksum-sha256"), false);
  assert.deepEqual(url.searchParams.get("X-Amz-SignedHeaders").split(";"), [
    "content-type",
    "host",
    "x-amz-checksum-sha256",
  ]);
  assert.equal(result.headers["x-amz-checksum-sha256"], checksum);
  assert.equal(result.headers["content-type"], "application/javascript");
});

test("upload signing still supports callers without a checksum", async () => {
  const result = await storage.createUploadUrl({
    contentType: "application/javascript",
    key: "client.js",
  });
  const url = new URL(result.uploadUrl);
  assert.equal(url.searchParams.has("x-amz-checksum-sha256"), false);
  assert.equal(result.headers["x-amz-checksum-sha256"], undefined);
  assert.ok(
    url.searchParams.get("X-Amz-SignedHeaders").includes("content-type")
  );
});

test("presigned gzip uploads sign and return content-encoding", async () => {
  const result = await storage.createUploadUrl({
    checksumSha256: Buffer.alloc(32).toString("base64"),
    contentEncoding: "gzip",
    contentType: "application/javascript",
    key: "client.js",
  });
  const signedHeaders = new URL(result.uploadUrl).searchParams
    .get("X-Amz-SignedHeaders")
    .split(";");
  assert.ok(signedHeaders.includes("content-encoding"));
  assert.equal(result.headers["content-encoding"], "gzip");
});
