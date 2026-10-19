import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { setConfigAppId } from "@patchsmith/vite/config/app-link";
import { patchsmithUploadManifestSchema } from "@patchsmith/vite/upload-manifest";
import { tool } from "ai";
import * as v from "valibot";
import { z } from "zod";

import { getSandbox } from "./sandbox";
import type { AppSandboxSession } from "./sandbox-session";
import { outputDirectory, verifyApp } from "./verification";

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
  AppSandboxSession,
  "runCommand" | "readFileToBuffer" | "writeFiles"
>;
interface Authorization {
  agentToken: string;
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
  const manifestBytes = await read("patchsmith-upload.json");
  const manifest = v.parse(
    patchsmithUploadManifestSchema,
    JSON.parse(manifestBytes.toString("utf-8"))
  );
  if (manifest.appId === undefined) {
    throw new Error(
      "Missing appId in patchsmith.config.ts. Link the app before deploying."
    );
  }
  const app = z.uuid().safeParse(manifest.appId).success
    ? { id: manifest.appId }
    : { shortId: manifest.appId };
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
      const failure = z
        .object({
          code: z.string().optional(),
          data: z
            .object({
              issues: z.array(
                z.object({
                  message: z.string(),
                  path: z.array(z.json()).optional(),
                })
              ),
            })
            .optional(),
          message: z.string().optional(),
        })
        .safeParse(await response.json().catch(() => null));
      const detail = failure.success
        ? [
            failure.data.code,
            failure.data.message,
            ...(failure.data.data?.issues ?? []).map(
              (issue) => `${JSON.stringify(issue.path ?? [])}: ${issue.message}`
            ),
          ]
            .filter(Boolean)
            .join(": ")
            .replaceAll(authorization.agentToken, "[redacted]")
            .slice(0, 1000)
        : "";
      throw new Error(
        `Deployment request failed (${response.status}).${detail ? ` ${detail}` : ""}`
      );
    }
    return await response.json();
  };
  const created = deploymentSchema.parse(
    await request(
      "",
      JSON.stringify({
        app,
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

export const createDeployTool = (dependencies: {
  sandbox: (name: string) => Promise<DeploymentSandbox>;
  publish: typeof publish;
}) =>
  tool({
    contextSchema: z.object({
      agentToken: z.string(),
      appId: z.string(),
      sandboxName: z.string(),
    }),
    description:
      "Verify and publish the completed app. Automatically formats, lints, runs existing tests, typechecks and builds. Call this directly when implementation is ready; separate verification commands are unnecessary. Failures report the check and diagnostics for repair. Publication requires every check to pass.",
    execute: async (_input, { context, abortSignal }) => {
      try {
        const sandbox = await dependencies.sandbox(context.sandboxName);
        const configPath = "/workspace/app/patchsmith.config.ts";
        const config = await sandbox.readFileToBuffer({ path: configPath });
        if (!config) {
          throw new Error("Missing app patchsmith.config.ts.");
        }
        const source = config.toString("utf-8");
        const linked = await setConfigAppId(source, context.appId, configPath);
        if (linked !== source) {
          await sandbox.writeFiles([
            { content: Buffer.from(linked), path: configPath },
          ]);
        }
        const result = await verifyApp(sandbox, abortSignal);
        if (result.exitCode !== 0) {
          return {
            exitCode: result.exitCode,
            stderr: result.stderr.replaceAll(context.agentToken, "[redacted]"),
            stdout: result.stdout.replaceAll(context.agentToken, "[redacted]"),
          };
        }
        const deployment = await dependencies.publish(
          sandbox,
          context,
          abortSignal
        );
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${result.stdout}\nDeployment: ${deployment.id}`,
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

export const deployTool = createDeployTool({
  publish,
  sandbox: async (name) => {
    const sandbox = await getSandbox(name);
    return sandbox.currentSession();
  },
});
