import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { maxDeploymentBytes } from "@patchsmith/asset-delivery";
import {
  maxLogoBytes,
  logoContentTypes,
} from "@patchsmith/asset-delivery/logo-validation";
import { isStaticAssetPath } from "@patchsmith/asset-delivery/static-assets";
import { db } from "@patchsmith/db";
import {
  app,
  AppAsset,
  AppDeployment,
  appDeployment,
  AppDeploymentFile,
  appDeploymentFile,
} from "@patchsmith/db/schema/apps";
import type { Scope } from "@patchsmith/db/schema/scope";
import { createShortId } from "@patchsmith/db/short-id";
import { setSpanAttributes } from "@patchsmith/observability";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { appSelectorSchema } from "#app-selector";
import type { Context } from "#context";
import { forEachSequential } from "#for-each-sequential";
import { paginatedOutput, paginationQuery } from "#pagination";
import { o, cliRouter, requireApp, requireAppInScopes } from "#procedures";
import {
  canonicalizeScope,
  canonicalizeScopes,
  scopeMatches,
  scopeSchema,
  scopesSchema,
} from "#scope";

import { getRuntimeBundle, publishRuntimeMetadata } from "./runtime";
import {
  deploymentStaticAssets,
  linkStaticAssets,
  prepareStaticAssets,
  staticAssetsInput,
  verifyStaticAssets,
} from "./static-assets";

const uploadUrlExpiresInSeconds = 15 * 60;

const bundleInspectionTimeoutMs = 10_000;

const deploymentFileMetadataFields = {
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/iu)
    .transform((checksum) => checksum.toLowerCase()),
};

const createDeploymentAssetInput = z.object({
  ...deploymentFileMetadataFields,
  contentLength: z.number().int().min(1),
  contentType: z.literal("application/javascript"),
  encoding: z.enum(["utf-8", "gzip"]),
  objectKey: z.literal("client.js"),
});

const createDeploymentServerInput = createDeploymentAssetInput.extend({
  contentLength: z.number().int().min(1).max(maxDeploymentBytes),
  objectKey: z.literal("server.js"),
});

const logoPathSchema = z
  .string()
  .refine(isStaticAssetPath, "Invalid logo asset path");

const deploymentLogos = z.object({
  dark: logoPathSchema.optional(),
  light: logoPathSchema.optional(),
});

const createDeploymentInput = z
  .object({
    app: appSelectorSchema,
    assets: z.tuple([createDeploymentAssetInput]),
    hooks: AppDeployment.shape.hooks.optional(),
    logos: deploymentLogos.optional(),
    scope: scopeSchema,
    server: createDeploymentServerInput.optional(),
    staticAssets: staticAssetsInput.optional(),
    views: AppDeployment.shape.views.optional(),
  })
  .refine(
    ({ hooks, server }) => (hooks?.length ?? 0) === 0 || server !== undefined,
    {
      message: "Hooks require a server bundle.",
    }
  )
  .refine(
    ({ assets, server, staticAssets }) =>
      assets.reduce((total, asset) => total + asset.contentLength, 0) +
        (server?.contentLength ?? 0) +
        (staticAssets ?? []).reduce(
          (total, asset) => total + asset.contentLength,
          0
        ) <=
      maxDeploymentBytes,
    {
      message: `Combined deployment assets cannot exceed ${maxDeploymentBytes} bytes.`,
    }
  );

const deploymentAssetUpload = z.object({
  file: AppDeploymentFile,
  headers: z.record(z.string(), z.string()).optional(),
  uploadUrl: z.url(),
});

const hexToBase64 = (hex: string): string => {
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return Buffer.from(bytes).toString("base64");
};

const inspectCompressedBundle = async (
  storage: Context["storage"],
  objectKey: string,
  remainingBytes: number
) => {
  const download = await storage.createDownloadUrl({
    expiresInSeconds: 60,
    key: objectKey,
  });

  const downloadUrl = new URL(download.url);

  if (downloadUrl.protocol !== "https:") {
    throw new Error("Bundle download URL must use HTTPS.");
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, bundleInspectionTimeoutMs);

  try {
    const response = await fetch(downloadUrl, {
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error("Failed to inspect uploaded bundle.");
    }

    // Node fetch decodes R2's Content-Encoding before exposing the response body.
    // Count chunks instead of buffering an arbitrarily large inflated bundle.
    let contentLength = 0;

    for await (const value of response.body) {
      contentLength += value.byteLength;

      if (contentLength > remainingBytes) {
        throw new Error(
          `Combined deployment assets cannot exceed ${maxDeploymentBytes} bytes after decompression.`
        );
      }
    }

    if (contentLength === 0) {
      throw new Error("Failed to inspect uploaded bundle.");
    }

    return contentLength;
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
};

export const mapReturnedFilesByAssetPath = <TFile extends { id: string }>(
  assets: readonly { asset: { objectKey: string }; fileId: string }[],
  files: readonly TFile[]
) => {
  const fileById = new Map(files.map((file) => [file.id, file]));

  return new Map(
    assets.map(({ asset, fileId }) => {
      const file = fileById.get(fileId);

      if (!file) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to resolve deployment asset.",
        });
      }

      return [asset.objectKey, file] as const;
    })
  );
};

const requireDeployment = o.middleware(
  async (
    { next, context },
    input: { deploymentId: string; scope?: Scope; scopes?: Scope[] }
  ) => {
    setSpanAttributes({
      "patchsmith.middleware": "require_deployment",
      "patchsmith.package": "api-platform",
      "patchsmith.resource_type": "deployment",
    });

    const deploymentWithApp = await db.query.appDeployment.findFirst({
      where: {
        id: input.deploymentId,
      },
      with: {
        app: true,
      },
    });

    const deploymentApp = deploymentWithApp?.app;

    let requestedScopes: Scope[];

    try {
      requestedScopes = input.scope
        ? [canonicalizeScope(input.scope).scope]
        : canonicalizeScopes(input.scopes).map(({ scope }) => scope);
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid deployment scope.",
      });
    }

    let storedScope: ReturnType<typeof canonicalizeScope> | null = null;

    if (deploymentApp) {
      try {
        const canonicalScope = canonicalizeScope(deploymentApp.scope);

        if (canonicalScope.scopeKey !== deploymentApp.scopeKey) {
          throw new TypeError(
            "Deployment app scope key does not match its stored scope."
          );
        }

        storedScope = canonicalScope;
      } catch (error) {
        console.warn("Deployment app has an invalid stored scope.", {
          appId: deploymentApp.id,
          deploymentId: input.deploymentId,
          error,
        });
      }
    }

    const scopeMatchesApp =
      storedScope !== null &&
      requestedScopes.some((scope) => scopeMatches(storedScope.scope, scope));

    if (
      !deploymentWithApp ||
      !deploymentApp ||
      deploymentApp.projectId !== context.project.id ||
      !scopeMatchesApp
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Deployment not found." });
    }

    const { app: _app, ...deployment } = deploymentWithApp;
    void _app;

    return await next({
      context: { ...context, app: deploymentApp, deployment },
    });
  }
);

const listAppDeployments = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/deployments/list",
    })
  )
  .input(
    z.object({
      body: paginationQuery.extend({
        app: appSelectorSchema,
        scopes: scopesSchema,
      }),
    })
  )
  .output(paginatedOutput(AppDeployment))
  .use(requireAppInScopes.adaptInput(({ body }) => body))
  .handler(async ({ context, input }) => {
    const { page, pageSize } = input.body;

    const deployments = await db.query.appDeployment.findMany({
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
      orderBy: {
        createdAt: "desc",
      },
      where: {
        appId: context.app.id,
      },
    });

    return {
      body: {
        items: deployments.slice(0, pageSize),
        pagination: {
          hasMore: deployments.length > pageSize,
          page,
          pageSize,
        },
      },
    };
  });

const getAppDeployment = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/deployments/{deploymentId}/lookup",
    })
  )
  .input(
    z.object({
      body: z.object({ scopes: scopesSchema }),
      params: z.object({ deploymentId: z.string() }),
    })
  )
  .output(
    z.object({
      body: AppDeployment.extend({ staticAssets: z.array(AppAsset) }),
    })
  )
  .use(
    requireDeployment.adaptInput(
      ({ params: { deploymentId }, body: { scopes } }) => ({
        deploymentId,
        scopes,
      })
    )
  )
  .handler(async ({ context }) => ({
    body: {
      ...context.deployment,
      staticAssets: await deploymentStaticAssets(context.deployment.id),
    },
  }));

const createAppDeployment = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/deployments",
    })
  )
  .input(
    z.object({
      body: createDeploymentInput,
    })
  )
  .output(
    z.object({
      body: z.object({
        assets: z.array(deploymentAssetUpload),
        deployment: AppDeployment,
        server: deploymentAssetUpload.optional(),
        staticAssets: z
          .array(
            z.object({
              file: AppAsset,
              headers: z.record(z.string(), z.string()).optional(),
              uploadUrl: z.url().optional(),
            })
          )
          .optional(),
      }),
    })
  )
  .use(requireApp.adaptInput(({ body }) => body))
  .handler(async ({ context, input }) => {
    const deploymentId = crypto.randomUUID();
    const deploymentShortId = createShortId();

    const preparedStaticAssets = await prepareStaticAssets(
      context,
      input.body.staticAssets ?? []
    );

    const logoPaths = Object.values(input.body.logos ?? {});

    for (const logoPath of logoPaths) {
      const asset = preparedStaticAssets.find(
        (entry) => entry.path === logoPath
      );

      if (
        !asset ||
        !logoContentTypes.some((type) => type === asset.contentType) ||
        asset.contentLength > maxLogoBytes
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Logos must reference SVG, PNG, or WebP assets within the logo size limit.",
        });
      }
    }

    const requestedAssets = [
      ...input.body.assets.map((asset) => ({ asset, kind: "client" as const })),
      ...(input.body.server
        ? [{ asset: input.body.server, kind: "server" as const }]
        : []),
    ];

    const assets = await Promise.all(
      requestedAssets.map(async ({ asset, kind }) => {
        const fileId = crypto.randomUUID();
        const appBaseKey = `projects/${context.project.shortId}/apps/${context.app.shortId}`;

        const objectKey = `${appBaseKey}/deployments/${deploymentShortId}/${kind}/${asset.objectKey}`;

        const uploadUrl = await context.storage.createUploadUrl({
          checksumSha256: hexToBase64(asset.checksum),
          contentEncoding: asset.encoding === "gzip" ? "gzip" : undefined,
          contentType: asset.contentType,
          expiresInSeconds: uploadUrlExpiresInSeconds,
          key: objectKey,
          metadata: {
            appDeploymentId: deploymentId,
            appId: context.app.id,
            fileId,
          },
        });

        return { asset, fileId, objectKey, uploadUrl };
      })
    );

    const created = await db.transaction(async (tx) => {
      const [deployment] = await tx
        .insert(appDeployment)
        .values({
          appId: context.app.id,
          hooks: input.body.hooks ?? [],
          id: deploymentId,
          shortId: deploymentShortId,
          status: "uploading",
          views: input.body.views ?? [],
        })
        .returning();

      if (!deployment) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to create deployment.",
        });
      }

      const files = await tx
        .insert(appDeploymentFile)
        .values(
          assets.map(({ asset, fileId, objectKey }) => ({
            appDeploymentId: deployment.id,
            checksum: asset.checksum,
            contentLength: asset.contentLength,
            contentType: asset.contentType,
            encoding: asset.encoding,
            id: fileId,
            objectKey,
          }))
        )
        .returning();

      if (files.length !== assets.length) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to create deployment asset.",
        });
      }

      const fileByAssetPath = mapReturnedFilesByAssetPath(assets, files);

      const logoAssetPath = (variant: "dark" | "light") => {
        const asset = preparedStaticAssets.find(
          (entry) => entry.path === input.body.logos?.[variant]
        );

        return asset ? `assets/${asset.checksum}/${asset.path}` : null;
      };

      const [updatedDeployment] = await tx
        .update(appDeployment)
        .set({
          clientEntryFileId: fileByAssetPath.get("client.js")?.id,
          logoDarkPath: logoAssetPath("dark"),
          logoLightPath: logoAssetPath("light"),
        })
        .where(eq(appDeployment.id, deployment.id))
        .returning();

      if (!updatedDeployment) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to update deployment asset.",
        });
      }

      const staticAssets = await linkStaticAssets(
        tx,
        context.app.id,
        deployment.id,
        preparedStaticAssets
      );

      return {
        createdDeployment: updatedDeployment,
        createdFiles: files,
        staticAssets,
      };
    });

    const { createdDeployment, createdFiles } = created;

    const createdFileById = new Map(
      createdFiles.map((file) => [file.id, file])
    );

    const uploadedAssetByName = new Map(
      assets.map(({ asset, fileId, uploadUrl }) => {
        const file = createdFileById.get(fileId);

        if (!file) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Failed to resolve deployment asset.",
          });
        }

        return [
          asset.objectKey,
          {
            file,
            headers: uploadUrl?.headers,
            uploadUrl: uploadUrl?.uploadUrl,
          },
        ] as const;
      })
    );

    const uploadedAssets = input.body.assets.map((asset) => {
      const upload = uploadedAssetByName.get(asset.objectKey);

      if (
        !(
          upload?.uploadUrl !== undefined &&
          upload?.uploadUrl !== null &&
          upload?.uploadUrl !== ""
        )
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Failed to resolve deployment asset.",
        });
      }

      return { ...upload, uploadUrl: upload.uploadUrl };
    });

    const serverUpload = input.body.server
      ? uploadedAssetByName.get("server.js")
      : undefined;

    if (
      input.body.server &&
      !(
        serverUpload?.uploadUrl !== undefined &&
        serverUpload?.uploadUrl !== null &&
        serverUpload?.uploadUrl !== ""
      )
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Failed to create server upload URL.",
      });
    }

    interface DeploymentUploads {
      assets: typeof uploadedAssets;
      deployment: typeof createdDeployment;
      staticAssets: typeof created.staticAssets;
      server?: typeof serverUpload & { uploadUrl: string };
    }

    const body: DeploymentUploads = {
      assets: uploadedAssets,
      deployment: createdDeployment,
      staticAssets: created.staticAssets,
    };

    if (
      serverUpload?.uploadUrl !== undefined &&
      serverUpload.uploadUrl !== ""
    ) {
      body.server = { ...serverUpload, uploadUrl: serverUpload.uploadUrl };
    }

    return { body };
  });

const publishAppDeployment = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/deployments/{deploymentId}",
    })
  )
  .input(
    z.object({
      body: z.object({
        rollout: z.boolean().optional().default(true),
        scope: scopeSchema,
      }),
      params: z.object({ deploymentId: z.string() }),
    })
  )
  .output(z.object({ body: AppDeployment }))
  .use(
    requireDeployment.adaptInput(
      ({ body: { scope }, params: { deploymentId } }) => ({
        deploymentId,
        scope,
      })
    )
  )
  .handler(async ({ context, input }) => {
    const { deployment } = context;

    const files = await db.query.appDeploymentFile.findMany({
      where: {
        appDeploymentId: deployment.id,
      },
    });

    if (files.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Deployment has no files to publish.",
      });
    }

    const staticAssets = await deploymentStaticAssets(deployment.id);

    const staticBytes = staticAssets.reduce(
      (total, asset) => total + asset.contentLength,
      0
    );

    const storedBytes =
      staticBytes +
      files.reduce((total, file) => total + file.contentLength, 0);

    if (storedBytes > maxDeploymentBytes) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Combined deployment assets cannot exceed ${maxDeploymentBytes} bytes.`,
      });
    }

    let deploymentBytes = staticBytes;

    await db
      .update(appDeployment)
      .set({ status: "verifying" })
      .where(eq(appDeployment.id, deployment.id));

    await forEachSequential(files, async (file) => {
      await db
        .update(appDeploymentFile)
        .set({ status: "verifying" })
        .where(eq(appDeploymentFile.id, file.id));

      try {
        const object = await context.storage.head({ key: file.objectKey });
        const { contentLength } = object;

        if (contentLength !== file.contentLength) {
          throw new Error(
            "Uploaded file content length does not match deployment record."
          );
        }

        if (object.contentType !== file.contentType) {
          throw new Error(
            "Uploaded file content type does not match deployment record."
          );
        }

        if (
          (object.contentEncoding ?? undefined) !==
          (file.encoding === "gzip" ? "gzip" : undefined)
        ) {
          throw new Error(
            "Uploaded file content encoding does not match deployment record."
          );
        }

        if (
          !(
            file.checksum !== undefined &&
            file.checksum !== null &&
            file.checksum !== ""
          ) ||
          object.checksumSha256 !== hexToBase64(file.checksum)
        ) {
          throw new Error(
            "Uploaded file checksum does not match deployment record."
          );
        }

        const decodedBytes =
          file.encoding === "gzip"
            ? await inspectCompressedBundle(
                context.storage,
                file.objectKey,
                maxDeploymentBytes - deploymentBytes
              )
            : contentLength;

        deploymentBytes += decodedBytes;

        if (deploymentBytes > maxDeploymentBytes) {
          throw new Error(
            `Combined deployment assets cannot exceed ${maxDeploymentBytes} bytes after decompression.`
          );
        }

        await db
          .update(appDeploymentFile)
          .set({ status: "verified" })
          .where(eq(appDeploymentFile.id, file.id));
      } catch (error) {
        await db
          .update(appDeploymentFile)
          .set({ status: "failed" })
          .where(eq(appDeploymentFile.id, file.id));

        await db
          .update(appDeployment)
          .set({ status: "uploading" })
          .where(eq(appDeployment.id, deployment.id));

        throw new ORPCError("BAD_REQUEST", {
          message:
            error instanceof Error
              ? error.message
              : "Failed to verify deployment file.",
        });
      }
    });

    try {
      await verifyStaticAssets(context.storage, deployment.id, [
        deployment.logoDarkPath,
        deployment.logoLightPath,
      ]);
    } catch (error) {
      await db
        .update(appDeployment)
        .set({ status: "uploading" })
        .where(eq(appDeployment.id, deployment.id));
      throw error;
    }

    const [publishedDeployment] = await db
      .update(appDeployment)
      .set({ status: "published" })
      .where(eq(appDeployment.id, deployment.id))
      .returning();

    if (!publishedDeployment) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Failed to publish deployment.",
      });
    }

    if (input.body.rollout) {
      await db
        .update(app)
        .set({ currentDeploymentId: publishedDeployment.id })
        .where(
          and(eq(app.id, context.app.id), eq(app.projectId, context.project.id))
        );

      const { selectRuntimeDeployment } =
        await import("#runtime/deployment-steps");

      const selected = await selectRuntimeDeployment(
        {
          appId: context.app.id,
          deploymentId: publishedDeployment.id,
          projectId: context.project.id,
        },
        db
      );

      const server = files.find((file) =>
        file.objectKey.endsWith("/server/server.js")
      );

      if (
        selected &&
        server?.checksum !== undefined &&
        server?.checksum !== null &&
        server?.checksum !== ""
      ) {
        await publishRuntimeMetadata(
          {
            appId: context.app.id,
            checksum: server.checksum,
            contentEncoding: server.encoding === "gzip" ? "gzip" : undefined,
            contentLength: server.contentLength,
            deploymentId: publishedDeployment.id,
            objectKey: server.objectKey,
            projectId: context.project.id,
          },
          context.app.shortId
        );
      }
    }

    return { body: publishedDeployment };
  });

export const deploymentRouter = o.router({
  create: createAppDeployment,
  get: getAppDeployment,
  list: listAppDeployments,
  publish: publishAppDeployment,
  runtime: getRuntimeBundle,
});
