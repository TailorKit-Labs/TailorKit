import { appDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";
import type { Identity } from "@patchsmith/app/server";
import { maxDeploymentBytes } from "@patchsmith/asset-delivery";
import { Effect, Semaphore } from "effect";
import { z } from "zod";

import { appError } from "../runtime/errors";
import { RuntimeTimings } from "../timing";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

export type ServerDeployment = AppDeploymentMetadata;

/** Deployment selects code, never the database. Issuer also separates trusted hosts. */
export const installationName = (
  identity: Pick<Identity, "projectId" | "appId" | "installationId">,
  issuer: string
) =>
  JSON.stringify([
    issuer,
    identity.projectId,
    identity.appId,
    identity.installationId,
  ]);

export const metadataRevalidateMs = 60 * 60 * 1000;

export interface DeploymentStorage {
  kv: {
    get: (key: string) => string | undefined;
    put: (key: string, value: string) => void;
    delete: (key: string) => boolean;
  };
  transactionSync: (write: () => void) => void;
}

const metadataKey = "runtime:metadata";
const bundleKey = "runtime:bundle";
const chunkLength = 16_384;

const storedMetadata = appDeploymentMetadata.extend({
  checkedAt: z.number(),
  tokenDeploymentId: z.string(),
});

const bundleManifest = z.object({
  chunks: z
    .number()
    .int()
    .min(1)
    .max(Math.ceil(maxDeploymentBytes / chunkLength)),
  version: z.string(),
});

const readStored = <T>(
  storage: DeploymentStorage,
  key: string,
  schema: z.ZodType<T>
) => {
  const value = storage.kv.get(key);

  if (value === undefined) {
    return null;
  }

  try {
    return schema.safeParse(JSON.parse(value)).data ?? null;
  } catch {
    return null;
  }
};

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
    BUNDLES: {
      get: (
        key: string
      ) => Promise<{ body: ReadableStream<Uint8Array> } | null>;
    };
  },
  storage: DeploymentStorage,
  waitUntil: (task: Promise<void>) => void
) => {
  let cached: { version: string; code: string } | undefined;

  let background: Promise<void> | undefined;
  const refreshQueue = Semaphore.makeUnsafe(1);
  let retryAfter = 0;

  // Serialize authoritative lookups, including pushes, so an older response can
  // never land after a newer confirmation in this installation.
  const refresh = async (
    identity: Pick<Identity, "appId" | "projectId" | "deploymentId">,
    timings = new RuntimeTimings()
  ) =>
    await Effect.runPromise(
      refreshQueue.withPermits(1)(
        Effect.tryPromise({
          catch: appError,
          try: async () => {
            const base = new URL(
              env.PLATFORM_URL.endsWith("/")
                ? env.PLATFORM_URL
                : `${env.PLATFORM_URL}/`
            );

            if (base.protocol !== "https:") {
              throw new Error("Platform URL requires HTTPS");
            }

            const response = await timings.time(
              "runtime_metadata_platform",
              async () =>
                await fetch(
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
                )
            );

            if (!response.ok) {
              throw new AppError(
                "UNAVAILABLE",
                "Published app metadata unavailable"
              );
            }

            const deployment = appDeploymentMetadata.parse(
              await response.json()
            );

            if (
              deployment.projectId !== identity.projectId ||
              deployment.appId !== identity.appId
            ) {
              throw new AppError("FORBIDDEN", "App or project mismatch");
            }

            storage.kv.put(
              metadataKey,
              JSON.stringify({
                ...deployment,
                checkedAt: Date.now(),
                tokenDeploymentId: identity.deploymentId,
              })
            );

            return deployment;
          },
        })
      )
    );

  const revalidate = async (identity: Identity) => {
    try {
      await refresh(identity);
    } catch (error) {
      retryAfter = Date.now() + 60_000;
      console.error("Could not revalidate app runtime metadata", error);
    } finally {
      background = undefined;
    }
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

          const manifest = readStored(storage, bundleKey, bundleManifest);

          if (manifest?.version === version) {
            const chunks = Array.from({ length: manifest.chunks }, (_, index) =>
              storage.kv.get(`${bundleKey}:${index}`)
            );

            const parsed = z.array(z.string()).safeParse(chunks);

            if (parsed.success) {
              const code = parsed.data.join("");
              cached = { code, version };

              return code;
            }
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

          storage.transactionSync(() => {
            const chunks = Math.max(1, Math.ceil(code.length / chunkLength));

            for (let index = 0; index < chunks; index += 1) {
              storage.kv.put(
                `${bundleKey}:${index}`,
                code.slice(index * chunkLength, (index + 1) * chunkLength)
              );
            }

            for (
              let index = chunks;
              index < (manifest?.chunks ?? 0);
              index += 1
            ) {
              storage.kv.delete(`${bundleKey}:${index}`);
            }

            storage.kv.put(bundleKey, JSON.stringify({ chunks, version }));
          });
          cached = { code, version };

          return code;
        },
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            // A corrected publication must be observable immediately after a bad bundle.
            storage.kv.delete(metadataKey);
          })
        )
      ),
    current: (
      identity: Identity,
      _runningDeploymentId?: string,
      timings = new RuntimeTimings()
    ) =>
      Effect.tryPromise({
        catch: appError,
        try: async () => {
          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          const stored = readStored(storage, metadataKey, storedMetadata);

          const matches =
            stored?.appId === identity.appId &&
            stored.projectId === identity.projectId;

          const hintChanged =
            matches &&
            identity.deploymentId !== stored.deploymentId &&
            identity.deploymentId !== stored.tokenDeploymentId;

          if (matches && !hintChanged) {
            if (
              Date.now() - stored.checkedAt >= metadataRevalidateMs &&
              !background &&
              Date.now() >= retryAfter
            ) {
              background = revalidate(identity);
              waitUntil(background);
            }

            return appDeploymentMetadata.parse(stored);
          }

          const deployment = await refresh(identity, timings);

          if (identity.expiresAt <= Date.now()) {
            throw new AppError("UNAUTHORIZED", "App token expired");
          }

          return deployment;
        },
      }),
    refresh,
  };
};
