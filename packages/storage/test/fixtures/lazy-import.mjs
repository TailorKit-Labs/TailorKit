import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const [entry, configured] = process.argv.slice(2);
const loaded = new Set();
// Observe real module loading without replacing dependencies.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    loaded.add(specifier);
    return nextResolve(specifier, context);
  },
});

const storageModule =
  entry === "index"
    ? await import("../../dist/index.mjs")
    : await import("../../dist/s3.mjs");
const { createS3CompatibleStorage } = storageModule;
const options = {
  accessKeyId: "test",
  bucket: "test",
  endpoint: "https://example.r2.cloudflarestorage.com",
  secretAccessKey: "test",
};
const direct = createS3CompatibleStorage(options);
assert.equal(direct.type, "s3");
assert.equal(loaded.has("@aws-sdk/client-s3"), false);
assert.equal(loaded.has("@aws-sdk/s3-request-presigner"), false);
assert.equal(loaded.has("@tailorkit/observability"), false);

if (entry === "index") {
  const { getStorage } = await import("../../dist/index.mjs");
  const configuredStorage = getStorage();
  assert.equal(configuredStorage, getStorage());
  if (configured === "configured") {
    assert.ok(configuredStorage);
    assert.equal(configuredStorage.type, "s3");
  } else {
    assert.equal(configuredStorage, null);
  }
  assert.equal(loaded.has("@aws-sdk/client-s3"), false);
  assert.equal(loaded.has("@tailorkit/observability"), false);
  if (configuredStorage) {
    const result = await configuredStorage.createDownloadUrl({
      key: "configured.txt",
    });
    assert.equal(new URL(result.url).pathname, "/test/configured.txt");
  }
}

const results = await Promise.all([
  direct.createDownloadUrl({ key: "first.txt" }),
  direct.createUploadUrl({ key: "second.txt" }),
]);
assert.ok(new URL(results[0].url).searchParams.has("X-Amz-Signature"));
assert.ok(new URL(results[1].uploadUrl).searchParams.has("X-Amz-Signature"));
assert.equal(loaded.has("@aws-sdk/client-s3"), true);
assert.equal(loaded.has("@aws-sdk/s3-request-presigner"), true);
assert.equal(loaded.has("@tailorkit/observability"), true);
hooks.deregister();
