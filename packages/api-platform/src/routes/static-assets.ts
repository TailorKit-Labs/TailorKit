import { ORPCError } from "@orpc/server";
import {
  isStaticAssetPath,
  maxStaticAssetBytes,
  maxStaticAssets,
  maxStaticDeploymentBytes,
  staticAssetContentType,
} from "@patchsmith/asset-delivery/static-assets";
import { db } from "@patchsmith/db";
import { appAsset, appDeploymentAsset } from "@patchsmith/db/schema/apps";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "#context";
import { forEachSequential } from "#for-each-sequential";

export const staticAssetsInput = z
  .array(
    z.object({
      checksum: z.string().regex(/^[a-f0-9]{64}$/u),
      contentLength: z.number().int().min(1).max(maxStaticAssetBytes),
      path: z.string().refine(isStaticAssetPath, "Invalid asset path"),
    })
  )
  .max(maxStaticAssets)
  .refine(
    (assets) => new Set(assets.map(({ path }) => path)).size === assets.length,
    "Asset paths must be unique"
  )
  .refine(
    (assets) =>
      assets.reduce((size, asset) => size + asset.contentLength, 0) <=
      maxStaticDeploymentBytes,
    "Static assets exceed the deployment size limit"
  );

type StaticAssetInput = z.output<typeof staticAssetsInput>[number];

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const checksumBase64 = (checksum: string) =>
  Buffer.from(checksum, "hex").toString("base64");

const missingObject = (cause: unknown): boolean => {
  const parsed = z
    .object({
      $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
      name: z.string().optional(),
    })
    .safeParse(cause);

  return (
    parsed.success &&
    (parsed.data.name === "NoSuchKey" ||
      parsed.data.name === "NotFound" ||
      parsed.data.$metadata?.httpStatusCode === 404)
  );
};

export const prepareStaticAssets = async (
  context: Context & { app: { id: string; shortId: string } },
  requested: StaticAssetInput[]
) =>
  await Promise.all(
    requested.map(async (asset) => {
      const contentType = staticAssetContentType(asset.path);
      const objectKey = `projects/${context.project.shortId}/apps/${context.app.shortId}/assets/${asset.checksum}/${asset.path}`;
      let exists = false;

      try {
        const object = await context.storage.head({ key: objectKey });

        if (
          object.checksumSha256 !== checksumBase64(asset.checksum) ||
          object.contentLength !== asset.contentLength ||
          object.contentType !== contentType ||
          (object.contentEncoding !== undefined &&
            object.contentEncoding !== "")
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "Stored asset metadata does not match its content address.",
          });
        }

        exists = true;
      } catch (error) {
        if (!missingObject(error)) {
          throw error;
        }
      }

      const upload = exists
        ? undefined
        : await context.storage.createUploadUrl({
            checksumSha256: checksumBase64(asset.checksum),
            contentType,
            expiresInSeconds: 15 * 60,
            key: objectKey,
            metadata: { appId: context.app.id, checksum: asset.checksum },
          });

      return { ...asset, contentType, objectKey, upload };
    })
  );

export const linkStaticAssets = async (
  tx: Transaction,
  appId: string,
  deploymentId: string,
  prepared: Awaited<ReturnType<typeof prepareStaticAssets>>
) =>
  await Promise.all(
    prepared.map(async ({ upload, ...asset }) => {
      const [file] = await tx
        .insert(appAsset)
        .values({ ...asset, appId })
        .onConflictDoUpdate({
          set: { updatedAt: new Date() },
          target: [appAsset.appId, appAsset.checksum, appAsset.path],
        })
        .returning();

      if (
        !file ||
        file.contentLength !== asset.contentLength ||
        file.contentType !== asset.contentType
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Asset metadata conflicts with the stored file.",
        });
      }

      await tx
        .insert(appDeploymentAsset)
        .values({ appAssetId: file.id, appDeploymentId: deploymentId, appId });

      return { file, headers: upload?.headers, uploadUrl: upload?.uploadUrl };
    })
  );

export const deploymentStaticAssets = async (deploymentId: string) => {
  const references = await db.query.appDeploymentAsset.findMany({
    where: { appDeploymentId: deploymentId },
    with: { asset: true },
  });

  return references
    .flatMap(({ asset }) => (asset ? [asset] : []))
    .toSorted((a, b) => a.path.localeCompare(b.path));
};

/** Signed uploads bind SHA-256 to the bytes; publication also verifies R2 metadata. */
export const verifyStaticAssets = async (
  storage: Context["storage"],
  deploymentId: string
) => {
  await forEachSequential(
    await deploymentStaticAssets(deploymentId),
    async (asset) => {
      try {
        const object = await storage.head({ key: asset.objectKey });

        if (
          object.checksumSha256 !== checksumBase64(asset.checksum) ||
          object.contentLength !== asset.contentLength ||
          object.contentType !== asset.contentType ||
          (object.contentEncoding !== undefined &&
            object.contentEncoding !== "")
        ) {
          throw new Error(
            `Uploaded asset does not match its deployment record: ${asset.path}`
          );
        }

        await db
          .update(appAsset)
          .set({ status: "verified" })
          .where(eq(appAsset.id, asset.id));
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          cause: error,
          message: `Failed to verify asset ${asset.path}.`,
        });
      }
    }
  );
};
