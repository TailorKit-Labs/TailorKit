import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { expect, it } from "vite-plus/test";

import { publish } from "./deploy";

const scope = { name: "user", value: { userId: "owner" } };
const authorization = {
  agentToken: `header.${Buffer.from(JSON.stringify({ platformUrl: "https://platform.test", scope })).toString("base64url")}.signature`,
  appId: "authorized-app",
};
const manifest = {
  assets: {
    client: "client/client.js",
    logos: { dark: "client/logo-dark.svg" },
    server: "server/server.js",
  },
  version: 1,
  views: [{ path: "/", slot: "panel" }],
};
const upload = (name: string) => ({
  uploadUrl: `https://storage.test/${name}`,
});
const reader = (document = JSON.stringify(manifest)) => ({
  readFileToBuffer: async ({ path }: { path: string }) =>
    await Promise.resolve(
      Buffer.from(
        path.endsWith("tailorkit-upload.json") ? document : "fixture bytes"
      )
    ),
});

it("publishes client, server and logos using host authorization", async () => {
  const calls: Request[] = [];
  const send: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    calls.push(request);
    if (request.method === "PUT") {
      expect(request.headers.has("authorization")).toBe(false);
      const bytes = Buffer.from(await request.arrayBuffer());
      const raw =
        request.headers.get("content-encoding") === "gzip"
          ? gunzipSync(bytes)
          : bytes;
      expect(raw.toString()).toBe("fixture bytes");
      return new Response(null);
    }
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${authorization.agentToken}`
    );
    const body = await request.json();
    if (request.url.endsWith("/deployments")) {
      expect(body).toMatchObject({
        appId: "authorized-app",
        scope,
        views: manifest.views,
      });
      const code = gzipSync(Buffer.from("fixture bytes"));
      expect(body).toMatchObject({
        assets: [
          {
            checksum: createHash("sha256").update(code).digest("hex"),
            contentLength: code.byteLength,
            encoding: "gzip",
            objectKey: "client.js",
          },
        ],
      });
      return Response.json({
        assets: [upload("client")],
        deployment: { id: "deployment" },
        logos: { dark: upload("logo") },
        server: upload("server"),
      });
    }
    expect(body).toEqual({ rollout: true, scope });
    return Response.json({ id: "deployment" });
  };
  expect(await publish(reader(), authorization, undefined, send)).toEqual({
    id: "deployment",
  });
  const uploads = calls.filter((request) => request.method === "PUT");
  expect(uploads).toHaveLength(3);
  expect(calls.at(-1)?.url).toBe(
    "https://platform.test/deployments/deployment"
  );
});

it("rejects a build manifest that escapes the output directory", async () => {
  let requests = 0;
  const send: typeof fetch = async () => {
    requests += 1;
    return await Promise.resolve(Response.json({}));
  };
  await expect(
    publish(
      reader(
        JSON.stringify({ ...manifest, assets: { client: "../../credentials" } })
      ),
      authorization,
      undefined,
      send
    )
  ).rejects.toThrow();
  expect(requests).toBe(0);
});

it("stops on denied authorization without uploading artifacts", async () => {
  const methods: string[] = [];
  const send: typeof fetch = async (url, init) => {
    methods.push(new Request(url, init).method);
    return await Promise.resolve(new Response(null, { status: 401 }));
  };
  await expect(
    publish(reader(), authorization, undefined, send)
  ).rejects.toThrow("401");
  expect(methods).toEqual(["POST"]);
});
