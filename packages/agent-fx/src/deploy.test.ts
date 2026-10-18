import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { publish } from "./deploy";

const scope = { name: "user", value: { userId: "owner" } };
const authorization = {
  agentToken: `header.${Buffer.from(JSON.stringify({ platformUrl: "https://platform.test", scope })).toString("base64url")}.signature`,
  appId: "23f9b80a-bce5-46c8-8fa4-6a319fd5be37",
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
  // Validate the selector against the platform's generated HTTP contract,
  // rather than maintaining a second, potentially outdated app schema here.
  const contract = z
    .object({
      paths: z.object({
        "/deployments": z.object({
          post: z.object({
            requestBody: z.object({
              content: z.object({
                "application/json": z.object({
                  schema: z.object({
                    properties: z.object({
                      app: z.record(z.string(), z.json()),
                    }),
                    required: z.array(z.string()),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../api-platform/openapi.json", import.meta.url),
          "utf-8"
        )
      )
    ).paths["/deployments"].post.requestBody.content["application/json"].schema;
  const selector = z.fromJSONSchema(contract.properties.app);
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
    const body = z.record(z.string(), z.json()).parse(await request.json());
    if (request.url.endsWith("/deployments")) {
      for (const field of contract.required) {
        expect(body).toHaveProperty(field);
      }
      expect(selector.parse(body.app)).toEqual({ id: authorization.appId });
      expect(body).toMatchObject({
        app: { id: authorization.appId },
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

it("includes platform diagnostics while redacting deployment credentials", async () => {
  const send: typeof fetch = async () =>
    await Promise.resolve(
      Response.json(
        {
          code: "BAD_REQUEST",
          data: {
            issues: [
              {
                message: `Expected app ${authorization.agentToken}`,
                path: ["app"],
              },
            ],
          },
          message: "Input validation failed",
        },
        { status: 400 }
      )
    );
  await expect(
    publish(reader(), authorization, undefined, send)
  ).rejects.toThrow(
    'Deployment request failed (400). BAD_REQUEST: Input validation failed: ["app"]: Expected app [redacted]'
  );
});

it.each([502, 503])(
  "reports non-JSON platform failures without masking status %s",
  async (status) => {
    const send: typeof fetch = async () =>
      await Promise.resolve(new Response("Service unavailable", { status }));
    await expect(
      publish(reader(), authorization, undefined, send)
    ).rejects.toThrow(`Deployment request failed (${status}).`);
  }
);

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
