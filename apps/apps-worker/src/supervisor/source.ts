import {
  appDeploymentMetadata,
  deploymentMetadataKey,
} from "@patchsmith/api-utils/app-auth";
import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";
import type { Identity } from "@patchsmith/app/server";
import { maxDeploymentBytes } from "@patchsmith/asset-delivery";
import { Effect } from "effect";

import { appError } from "../runtime/errors";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

export type ServerDeployment = AppDeploymentMetadata;

/** Deployment selects code, never the database. Issuer also separates trusted hosts. */
export const installationName = (identity: Identity, issuer: string) =>
  JSON.stringify([
    issuer,
    identity.projectId,
    identity.appId,
    identity.installationId,
  ]);

export const metadataLifetimeSeconds = 300;
export const warmMetadataLifetimeMs = 5000;

/** Bound stored and inflated bytes before allocating or executing bundle code. */
const readBundleBytes = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array<ArrayBuffer>> => {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const value of stream) {
    length += value.byteLength;

    if (length > maxDeploymentBytes) {
      throw new Error("Server bundle exceeds deployment size limit");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

/** Only this trusted service sees platform credentials or the private R2 binding. */
export const deploymentSource = (
  env: Pick<Env, "PLATFORM_URL" | "RUNTIME_SERVICE_TOKEN"> & {
    DEPLOYMENTS: {
      get: (key: string, type: "json") => Promise<ServerDeployment | null>;
      put: (
        key: string,
        value: string,
        options: { expirationTtl: number }
      ) => Promise<void>;
    };
    BUNDLES: {
      get: (
        key: string
      ) => Promise<{ body: ReadableStream<Uint8Array> } | null>;
    };
  }
) => {
  let cached: { version: string; code: string } | undefined;

  let metadata:
    | {
        key: string;
        deployment: ServerDeployment;
        tokenDeploymentId: string;
        expiresAt: number;
      }
    | undefined;

  const tokenChanged = (identity: Identity, key: string) =>
    metadata?.key === key &&
    identity.deploymentId !== metadata.tokenDeploymentId &&
    identity.deploymentId !== metadata.deployment.deploymentId;

  const warmDeployment = (
    key: string,
    runningDeploymentId?: string
  ): ServerDeployment | undefined => {
    const reusable =
      metadata?.key === key &&
      metadata.expiresAt > Date.now() &&
      (runningDeploymentId === undefined ||
        runningDeploymentId === "" ||
        runningDeploymentId === metadata.deployment.deploymentId);

    return reusable ? metadata?.deployment : undefined;
  };

  return {
    code: (deployment: ServerDeployment) =>
      Effect.tryPromise({
        catch: appError,
        try: async () => {
          const version = `${deployment.deploymentId}:${deployment.checksum}:${deployment.contentEncoding ?? "utf-8"}`;

          if (cached?.version === version) {
            return cached.code;
          }

          const object = await env.BUNDLES.get(deployment.objectKey);

          if (!object) {
            throw new AppError("NOT_FOUND", "Server bundle missing");
          }

          const bytes = await readBundleBytes(object.body);

          if (bytes.byteLength !== deployment.contentLength) {
            throw new Error("Server bundle size mismatch");
          }

          const hash = new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes)
          );

          const checksum = [...hash]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");

          if (checksum !== deployment.checksum) {
            throw new Error("Server bundle checksum mismatch");
          }

          const decoded =
            deployment.contentEncoding === "gzip"
              ? await readBundleBytes(
                  requireValue(new Response(bytes).body).pipeThrough(
                    new DecompressionStream("gzip")
                  )
                )
              : bytes;

          const code = new TextDecoder("utf-8", { fatal: true }).decode(
            decoded
          );

          cached = { code, version };

          return code;
        },
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            // A corrected publication must be observable immediately after a bad bundle.
            metadata = undefined;
          })
        )
      ),

    current: (identity: Identity, runningDeploymentId?: string) =>
      Effect.tryPromise({
        catch: appError,
        try: async () => {
          const key = deploymentMetadataKey(identity);
          const now = Date.now();

          if (identity.expiresAt <= now) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          const deploymentHintChanged = tokenChanged(identity, key);

          const warm = warmDeployment(key, runningDeploymentId);

          if (warm && !deploymentHintChanged) {
            return warm;
          }

          const cachedMetadata = appDeploymentMetadata.safeParse(
            await env.DEPLOYMENTS.get(key, "json").catch(() => null)
          );

          let deployment = cachedMetadata.success
            ? cachedMetadata.data
            : undefined;

          // Confirm a changed pointer with the authority before switching schemas.
          // This prevents a stale KV replica from switching an installation backwards.
          if (
            !deployment ||
            deploymentHintChanged ||
            (runningDeploymentId !== undefined &&
              runningDeploymentId !== null &&
              runningDeploymentId !== "" &&
              deployment.deploymentId !== runningDeploymentId)
          ) {
            const base = new URL(
              env.PLATFORM_URL.endsWith("/")
                ? env.PLATFORM_URL
                : `${env.PLATFORM_URL}/`
            );

            if (base.protocol !== "https:") {
              throw new Error("Platform URL requires HTTPS");
            }

            const response = await fetch(
              new URL(
                `apps/${encodeURIComponent(identity.appId)}/runtime`,
                base
              ),
              {
                body: JSON.stringify({}),
                headers: {
                  authorization: `Bearer ${env.RUNTIME_SERVICE_TOKEN}`,
                  "content-type": "application/json",
                  "x-patchsmith-project-id": identity.projectId,
                },
                method: "POST",
                redirect: "manual",
                signal: AbortSignal.timeout(10_000),
              }
            );

            if (!response.ok) {
              throw new AppError(
                "UNAVAILABLE",
                "Published app metadata unavailable"
              );
            }

            deployment = appDeploymentMetadata.parse(await response.json());

            if (
              deployment.projectId !== identity.projectId ||
              deployment.appId !== identity.appId
            ) {
              throw new AppError("FORBIDDEN", "App or project mismatch");
            }

            await env.DEPLOYMENTS.put(key, JSON.stringify(deployment), {
              expirationTtl: metadataLifetimeSeconds,
              // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript may reject with arbitrary values; this boundary records or preserves the original failure.
            }).catch((error: unknown) => {
              console.error("Could not cache app deployment metadata", error);
            });
          }

          if (
            deployment.projectId !== identity.projectId ||
            deployment.appId !== identity.appId
          ) {
            throw new AppError("FORBIDDEN", "App or project mismatch");
          }

          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          metadata = {
            deployment,
            expiresAt: now + warmMetadataLifetimeMs,
            key,
            tokenDeploymentId: identity.deploymentId,
          };

          return deployment;
        },
      }),
  };
};
