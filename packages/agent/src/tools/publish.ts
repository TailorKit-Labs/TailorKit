import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { tailorkitUploadManifestSchema } from "@tailorkit/vite/builder";
import type { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

export const deploymentDirectory = "/tmp/tailorkit-deployment";
const maxAssetBytes = 3 * 1024 * 1024;
const gzipAsync = promisify(gzip);
const claimsSchema = z.object({
  platformUrl: z.url().refine((value) => {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  scope: z.object({
    name: z.string().min(1),
    value: z.record(z.string(), z.json()),
  }),
});
const uploadSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  uploadUrl: z.url().optional(),
});
const createdSchema = z.object({
  assets: z.array(uploadSchema.extend({ uploadUrl: z.url() })).length(1),
  deployment: z.object({ id: z.string().min(1) }),
  logos: z
    .object({ dark: uploadSchema.optional(), light: uploadSchema.optional() })
    .optional(),
  server: uploadSchema.extend({ uploadUrl: z.url() }).optional(),
});
const publishedSchema = z.object({ id: z.string().min(1) });

type ReadArtifact = Pick<
  ReturnType<Sandbox["currentSession"]>,
  "readFileToBuffer"
>;
const logoTypes = {
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const;

const readAsset = async (sandbox: ReadArtifact, filename: string) => {
  const content = await sandbox.readFileToBuffer({
    path: `${deploymentDirectory}/${filename}`,
  });
  if (content === null || content.byteLength > maxAssetBytes) {
    throw new Error(`Missing or oversized deployment asset: ${filename}`);
  }
  return content;
};

const describeAsset = (content: Buffer) => {
  if (content.byteLength > maxAssetBytes) {
    throw new Error("Deployment asset exceeds the size limit.");
  }
  return {
    checksum: createHash("sha256").update(content).digest("hex"),
    contentLength: content.byteLength,
  };
};

/** Only the host publishes; sandbox output is parsed as data and never executed here. */
export const publishDeployment = async (
  sandbox: ReadArtifact,
  authorization: { agentToken: string; appId: string },
  signal?: AbortSignal,
  fetchImplementation: typeof fetch = fetch
) => {
  const { agentToken, appId } = authorization;
  // Decode routing only; the platform still verifies the grant, scope, expiry, and revocation.
  const [, payload] = agentToken.split(".");
  if (payload === undefined || payload === "") {
    throw new Error("Invalid deployment authorization.");
  }
  const { platformUrl, scope } = claimsSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
  );
  const manifestContent = await readAsset(sandbox, "tailorkit-upload.json");
  const manifest = tailorkitUploadManifestSchema.parse(
    JSON.parse(manifestContent.toString("utf-8"))
  );
  const clientCode = await gzipAsync(
    await readAsset(sandbox, manifest.assets.client)
  );
  const serverCode = manifest.assets.server
    ? await gzipAsync(await readAsset(sandbox, manifest.assets.server))
    : undefined;
  const logos = [];
  for (const variant of ["dark", "light"] as const) {
    const filename = manifest.assets.logos?.[variant];
    if (filename === undefined) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Validate each of the two optional logos before creating a deployment.
    const content = await readAsset(sandbox, filename);
    const extension = filename.split(".").at(-1);
    if (extension !== "png" && extension !== "svg" && extension !== "webp") {
      throw new Error("Unsupported deployment logo format.");
    }
    logos.push({ content, contentType: logoTypes[extension], variant });
  }
  const request = async (pathname: string, body: string) => {
    const response = await fetchImplementation(
      `${platformUrl.replace(/\/$/u, "")}${pathname}`,
      {
        body,
        headers: {
          authorization: `Bearer ${agentToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal,
      }
    );
    if (!response.ok) {
      throw new Error(`Deployment request failed with ${response.status}.`);
    }
    return await response.json();
  };
  const created = createdSchema.parse(
    await request(
      "/deployments",
      JSON.stringify({
        appId,
        assets: [
          {
            ...describeAsset(clientCode),
            contentType: "application/javascript",
            encoding: "gzip",
            objectKey: "client.js",
          },
        ],
        logos:
          logos.length > 0
            ? Object.fromEntries(
                logos.map((logo) => [
                  logo.variant,
                  {
                    ...describeAsset(logo.content),
                    contentType: logo.contentType,
                  },
                ])
              )
            : undefined,
        scope,
        server: serverCode
          ? {
              ...describeAsset(serverCode),
              contentType: "application/javascript",
              encoding: "gzip",
              objectKey: "server.js",
            }
          : undefined,
        views: manifest.views,
      })
    )
  );
  const upload = async (
    destination: z.infer<typeof uploadSchema> | undefined,
    content: Buffer,
    encoding?: "gzip"
  ) => {
    if (destination === undefined || content.byteLength > maxAssetBytes) {
      throw new Error(
        "Missing upload destination or oversized deployment asset."
      );
    }
    // An existing content-addressed logo has no upload URL.
    if (destination.uploadUrl === undefined) {
      return;
    }
    const headers = new Headers(destination.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/javascript");
    }
    if (encoding !== undefined) {
      headers.set("content-encoding", encoding);
    }
    const response = await fetchImplementation(destination.uploadUrl, {
      body: new Uint8Array(content),
      headers,
      method: "PUT",
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Asset upload failed with ${response.status}.`);
    }
  };
  await upload(created.assets[0], clientCode, "gzip");
  if (serverCode !== undefined) {
    await upload(created.server, serverCode, "gzip");
  }
  await Promise.all(
    logos.map(async (logo) => {
      await upload(created.logos?.[logo.variant], logo.content);
    })
  );
  const published = publishedSchema.parse(
    await request(
      `/deployments/${encodeURIComponent(created.deployment.id)}`,
      JSON.stringify({ rollout: true, scope })
    )
  );
  return `Deployment: ${published.id}`;
};
