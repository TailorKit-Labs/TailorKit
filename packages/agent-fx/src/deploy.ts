import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { tailorkitUploadManifestSchema } from "@tailorkit/vite/upload-manifest";
import type { Sandbox } from "@vercel/sandbox";
import { tool } from "ai";
import * as v from "valibot";
import { z } from "zod";

import { getSandbox } from "./sandbox";

const outputDirectory = "/tmp/fx-deployment";
const authorizationSchema = z.object({
  platformUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  scope: z.object({ name: z.string(), value: z.record(z.string(), z.json()) }),
});
const uploadSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  uploadUrl: z.url().optional(),
});
const deploymentSchema = z.object({
  assets: z.array(uploadSchema.extend({ uploadUrl: z.url() })).length(1),
  deployment: z.object({ id: z.string().min(1) }),
  logos: z
    .object({ dark: uploadSchema.optional(), light: uploadSchema.optional() })
    .optional(),
  server: uploadSchema.extend({ uploadUrl: z.url() }).optional(),
});
type DeploymentSandbox = Pick<
  ReturnType<Sandbox["currentSession"]>,
  "runCommand" | "readFileToBuffer"
>;
interface Authorization {
  agentToken: string;
  appId: string;
}

/** Parse build output and publish on the host; authorization never enters the VM. */
export const publish = async (
  sandbox: Pick<DeploymentSandbox, "readFileToBuffer">,
  authorization: Authorization,
  signal?: AbortSignal,
  send: typeof fetch = fetch
) => {
  const [, payload] = authorization.agentToken.split(".");
  if (payload === undefined || payload === "") {
    throw new Error("Missing deployment authorization.");
  }
  // Routing claims only; the platform verifies authorization on both requests.
  const { platformUrl, scope } = authorizationSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
  );
  const read = async (filename: string) => {
    const bytes = await sandbox.readFileToBuffer({
      path: `${outputDirectory}/${filename}`,
    });
    if (!bytes || bytes.byteLength > 3 * 1024 ** 2) {
      throw new Error(`Missing or oversized artifact: ${filename}`);
    }
    return bytes;
  };
  const manifestBytes = await read("tailorkit-upload.json");
  const manifest = v.parse(
    tailorkitUploadManifestSchema,
    JSON.parse(manifestBytes.toString("utf-8"))
  );
  const artifact = async (
    filename: string,
    contentType: string,
    compress: boolean
  ) => {
    const bytes = await read(filename);
    const content = compress ? gzipSync(bytes) : bytes;
    if (content.byteLength > 3 * 1024 ** 2) {
      throw new Error("Compressed artifact exceeds the upload limit.");
    }
    return {
      content,
      metadata: {
        checksum: createHash("sha256").update(content).digest("hex"),
        contentLength: content.byteLength,
        contentType,
        encoding: compress ? "gzip" : undefined,
        objectKey: compress ? filename.split("/").at(-1) : undefined,
      },
    };
  };
  const client = await artifact(
    manifest.assets.client,
    "application/javascript",
    true
  );
  const server = manifest.assets.server
    ? await artifact(manifest.assets.server, "application/javascript", true)
    : undefined;
  const logos = await Promise.all(
    (["dark", "light"] as const).map(async (variant) => {
      const filename = manifest.assets.logos?.[variant];
      if (filename === undefined) {
        return null;
      }
      const contentType = filename.endsWith(".svg")
        ? "image/svg+xml"
        : `image/${filename.split(".").at(-1)}`;
      return { variant, ...(await artifact(filename, contentType, false)) };
    })
  );
  const request = async (path: string, body: string) => {
    const response = await send(
      `${platformUrl.replace(/\/$/u, "")}/deployments${path}`,
      {
        body,
        headers: {
          authorization: `Bearer ${authorization.agentToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal,
      }
    );
    if (!response.ok) {
      throw new Error(`Deployment request failed (${response.status}).`);
    }
    return await response.json();
  };
  const created = deploymentSchema.parse(
    await request(
      "",
      JSON.stringify({
        appId: authorization.appId,
        assets: [client.metadata],
        logos: Object.fromEntries(
          logos.flatMap((logo) => (logo ? [[logo.variant, logo.metadata]] : []))
        ),
        scope,
        server: server?.metadata,
        views: manifest.views,
      })
    )
  );
  const upload = async (
    asset: Awaited<ReturnType<typeof artifact>>,
    destination: z.infer<typeof uploadSchema> | undefined
  ) => {
    if (!destination) {
      throw new Error("Missing artifact upload destination.");
    }
    // Content-addressed logos can already exist.
    if (destination.uploadUrl === undefined) {
      return;
    }
    const headers = new Headers(destination.headers);
    headers.set("content-type", asset.metadata.contentType);
    if (asset.metadata.encoding !== undefined) {
      headers.set("content-encoding", asset.metadata.encoding);
    }
    const response = await send(destination.uploadUrl, {
      body: new Uint8Array(asset.content),
      headers,
      method: "PUT",
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Artifact upload failed (${response.status}).`);
    }
  };
  await Promise.all([
    upload(client, created.assets[0]),
    ...(server ? [upload(server, created.server)] : []),
    ...logos.flatMap((logo) =>
      logo ? [upload(logo, created.logos?.[logo.variant])] : []
    ),
  ]);
  return z
    .object({ id: z.string().min(1) })
    .parse(
      await request(
        `/${encodeURIComponent(created.deployment.id)}`,
        JSON.stringify({ rollout: true, scope })
      )
    );
};

export const deployTool = tool({
  contextSchema: z.object({
    agentToken: z.string(),
    appId: z.string(),
    sandboxName: z.string(),
  }),
  description:
    "Type-check, build, and publish the completed app. Run lint and relevant tests first. Repair diagnostics and retry if needed.",
  execute: async (_input, { context, abortSignal }) => {
    try {
      const vm = await getSandbox(context.sandboxName);
      const sandbox = vm.currentSession();
      const result = await sandbox.runCommand({
        args: [
          "-c",
          `pnpm exec tsc --noEmit && pnpm exec node --input-type=module --eval 'import {build} from "vite"; await build({build:{outDir:"${outputDirectory}"}});'`,
        ],
        cmd: "bash",
        cwd: "/workspace/app",
        env: { CI: "true", NO_COLOR: "1" },
        signal: abortSignal,
        timeoutMs: 15 * 60_000,
      });
      if (result.exitCode !== 0) {
        return {
          exitCode: result.exitCode,
          stderr: await result.stderr(),
          stdout: await result.stdout(),
        };
      }
      const deployment = await publish(sandbox, context, abortSignal);
      return {
        exitCode: 0,
        stderr: "",
        stdout: `Deployment: ${deployment.id}`,
      };
    } catch (error) {
      return {
        exitCode: 1,
        stderr: (error instanceof Error
          ? error.message
          : String(error)
        ).replaceAll(context.agentToken, "[redacted]"),
        stdout: "",
      };
    }
  },
  inputSchema: z.strictObject({}),
});
