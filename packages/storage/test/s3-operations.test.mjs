import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { createS3CompatibleStorage } from "../dist/s3.mjs";

void test("lazy storage forwards head, delete, and service errors", async (context) => {
  /** @type {{ method: string | undefined; url: string | undefined }[]} */
  const requests = [];
  const checksum = Buffer.alloc(32).toString("base64");
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url?.includes("missing") === true) {
      response.writeHead(404);
    } else if (request.method === "HEAD") {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": "123",
        "content-type": "application/javascript",
        etag: '"test-etag"',
        "x-amz-checksum-sha256": checksum,
        "x-amz-meta-fileid": "test-file",
      });
    } else {
      response.writeHead(204);
    }
    response.end();
  });
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null);
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node returns a string for Unix sockets; this test listens on a TCP port.
  assert.ok(typeof address !== "string");

  const storage = createS3CompatibleStorage({
    accessKeyId: "test",
    bucket: "test",
    endpoint: `http://127.0.0.1:${address.port}`,
    secretAccessKey: "test",
  });
  assert.deepEqual(await storage.head({ key: "assets/client.js" }), {
    checksumSha256: checksum,
    contentEncoding: "gzip",
    contentLength: 123,
    contentType: "application/javascript",
    etag: '"test-etag"',
    key: "assets/client.js",
    metadata: { fileid: "test-file" },
  });
  await assert.rejects(storage.head({ key: "missing" }), { name: "NotFound" });
  await storage.delete({ key: "assets/client.js" });
  assert.deepEqual(
    requests.map(({ method, url }) => ({
      method,
      path: new URL(url ?? "", "http://localhost").pathname,
    })),
    [
      { method: "HEAD", path: "/test/assets/client.js" },
      { method: "HEAD", path: "/test/missing" },
      { method: "DELETE", path: "/test/assets/client.js" },
    ]
  );
});
