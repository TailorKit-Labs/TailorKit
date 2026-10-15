import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { expect, it } from "vite-plus/test";

import { deploymentDirectory, publishDeployment } from "./publish";

const scope = { name: "user", value: { userId: "authorized-user" } };
const token = `header.${Buffer.from(JSON.stringify({ platformUrl: "https://platform.test/api/platform", scope })).toString("base64url")}.signature`;
const authorization = { agentToken: token, appId: "authorized-app" };
const clientCode = Buffer.from("export const client = true;");
const serverCode = Buffer.from("export const server = true;");
const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const manifest = {
  assets: {
    client: "client/client.js",
    logos: { dark: "client/logo-dark.svg" },
    server: "server/server.js",
  },
  version: 1,
  views: [{ path: "/", slot: "panel" }],
};
const reader = (overrides: Record<string, Buffer> = {}) => {
  const files = new Map<string, Buffer>(
    Object.entries({
      "client/client.js": clientCode,
      "client/logo-dark.svg": logo,
      "server/server.js": serverCode,
      "tailorkit-upload.json": Buffer.from(JSON.stringify(manifest)),
      ...overrides,
    })
  );
  return {
    readFileToBuffer: async ({ path }: { path: string }) =>
      await Promise.resolve(
        files.get(path.slice(deploymentDirectory.length + 1)) ?? null
      ),
  };
};

it("uploads data on the host and keeps authorization out of signed asset requests", async () => {
  const requests: Request[] = [];
  const { signal } = new AbortController();
  const send: typeof fetch = async (input, init) => {
    expect(init?.signal).toBe(signal);
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === "https://platform.test/api/platform/deployments") {
      return await Promise.resolve(
        Response.json({
          assets: [
            {
              headers: { "content-type": "application/javascript" },
              uploadUrl: "https://storage.test/client",
            },
          ],
          deployment: { id: "created-deployment" },
          logos: {
            dark: {
              headers: { "content-type": "image/svg+xml" },
              uploadUrl: "https://storage.test/logo",
            },
          },
          server: { uploadUrl: "https://storage.test/server" },
        })
      );
    }
    if (
      request.url ===
      "https://platform.test/api/platform/deployments/created-deployment"
    ) {
      return await Promise.resolve(
        Response.json({ id: "published-deployment" })
      );
    }
    return await Promise.resolve(new Response(null, { status: 200 }));
  };
  expect(
    await publishDeployment(
      reader({
        "tailorkit-upload.json": Buffer.from(
          JSON.stringify({
            ...manifest,
            appId: "foreign-app",
            platformUrl: "https://untrusted.test",
            scope: { name: "other" },
          })
        ),
      }),
      authorization,
      signal,
      send
    )
  ).toBe("Deployment: published-deployment");
  expect(requests.map((request) => request.url)).toEqual([
    "https://platform.test/api/platform/deployments",
    "https://storage.test/client",
    "https://storage.test/server",
    "https://storage.test/logo",
    "https://platform.test/api/platform/deployments/created-deployment",
  ]);
  const [create, clientUpload, serverUpload, logoUpload, publish] = requests;
  if (!create || !clientUpload || !serverUpload || !logoUpload || !publish) {
    throw new Error("Expected create, uploads, and publication.");
  }
  for (const request of [create, publish]) {
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(request.redirect).toBe("error");
  }
  for (const request of [clientUpload, serverUpload, logoUpload]) {
    expect(request.headers.has("authorization")).toBe(false);
  }
  const clientBytes = Buffer.from(await clientUpload.arrayBuffer());
  expect(gunzipSync(clientBytes)).toEqual(clientCode);
  expect(gunzipSync(Buffer.from(await serverUpload.arrayBuffer()))).toEqual(
    serverCode
  );
  expect(Buffer.from(await logoUpload.arrayBuffer())).toEqual(logo);
  expect(await create.json()).toMatchObject({
    appId: authorization.appId,
    assets: [
      {
        checksum: createHash("sha256").update(clientBytes).digest("hex"),
        contentLength: clientBytes.byteLength,
        encoding: "gzip",
      },
    ],
    scope,
    views: manifest.views,
  });
  expect(await publish.json()).toEqual({ rollout: true, scope });
});

it.each([
  { ...manifest, assets: { client: "../../secret" } },
  {
    ...manifest,
    assets: { ...manifest.assets, logos: { dark: "../../secret" } },
  },
])(
  "rejects manifest paths outside the build output",
  async (untrustedManifest) => {
    let requests = 0;
    const send: typeof fetch = async () => {
      requests += 1;
      return await Promise.resolve(Response.json({}));
    };
    await expect(
      publishDeployment(
        reader({
          "tailorkit-upload.json": Buffer.from(
            JSON.stringify(untrustedManifest)
          ),
        }),
        authorization,
        undefined,
        send
      )
    ).rejects.toThrow();
    expect(requests).toBe(0);
  }
);

it("rejects oversized output before an authenticated deployment request", async () => {
  let requests = 0;
  const send: typeof fetch = async () => {
    requests += 1;
    return await Promise.resolve(Response.json({}));
  };
  await expect(
    publishDeployment(
      reader({ "client/client.js": Buffer.alloc(3 * 1024 * 1024 + 1) }),
      authorization,
      undefined,
      send
    )
  ).rejects.toThrow("oversized");
  expect(requests).toBe(0);
});

it("honors platform authorization failures without uploading or publishing", async () => {
  const requests: string[] = [];
  const send: typeof fetch = async (input) => {
    requests.push(new Request(input).url);
    return await Promise.resolve(new Response(null, { status: 401 }));
  };
  await expect(
    publishDeployment(reader(), authorization, undefined, send)
  ).rejects.toThrow("401");
  expect(requests).toEqual(["https://platform.test/api/platform/deployments"]);
});
