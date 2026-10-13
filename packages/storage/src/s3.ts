import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { withSpan } from "@tailorkit/observability";

import type {
  CreateDownloadUrlInput,
  CreateDownloadUrlOutput,
  CreateUploadUrlInput,
  CreateUploadUrlOutput,
  DeleteObjectInput,
  HeadObjectInput,
  HeadObjectOutput,
  Storage,
} from "./types.js";

export interface S3CompatibleStorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

const createS3Client = (options: S3CompatibleStorageOptions): S3Client => {
  const config: S3ClientConfig = {
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    region: options.region ?? "auto",
  };

  if (options.accessKeyId && options.secretAccessKey) {
    config.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    };
  }

  return new S3Client(config);
};

export const createS3CompatibleStorage = (
  options: S3CompatibleStorageOptions
): Storage<"s3"> => {
  const client = createS3Client(options);

  return {
    createDownloadUrl: async (
      input: CreateDownloadUrlInput
    ): Promise<CreateDownloadUrlOutput> => {
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
      });

      return {
        key: input.key,
        url: await withSpan(
          "storage.create_download_url",
          {
            attributes: {
              "storage.expires_seconds": input.expiresInSeconds ?? 300,
              "storage.type": "s3",
              "tailorkit.package": "storage",
            },
          },
          () =>
            getSignedUrl(client, command, {
              expiresIn: input.expiresInSeconds ?? 300,
            })
        ),
      };
    },
    createUploadUrl: async (
      input: CreateUploadUrlInput
    ): Promise<CreateUploadUrlOutput> => {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        ChecksumSHA256: input.checksumSha256,
        ContentEncoding: input.contentEncoding,
        ContentType: input.contentType,
        Key: input.key,
        Metadata: input.metadata,
      });

      return {
        headers: {
          ...(input.contentType ? { "content-type": input.contentType } : {}),
          ...(input.contentEncoding
            ? { "content-encoding": input.contentEncoding }
            : {}),
          ...(input.checksumSha256
            ? { "x-amz-checksum-sha256": input.checksumSha256 }
            : {}),
        },
        key: input.key,
        uploadUrl: await withSpan(
          "storage.create_upload_url",
          {
            attributes: {
              "storage.expires_seconds": input.expiresInSeconds ?? 300,
              "storage.type": "s3",
              "tailorkit.package": "storage",
            },
          },
          () =>
            getSignedUrl(client, command, {
              expiresIn: input.expiresInSeconds ?? 300,

              signableHeaders: new Set(["content-type", "content-encoding"]),

              // The upload contract sends this checksum as a header. Keep it
              // signed there instead of also hoisting it into the query string.
              unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
            })
        ),
      };
    },
    delete: async (input: DeleteObjectInput): Promise<void> => {
      await withSpan(
        "storage.delete",
        {
          attributes: { "storage.type": "s3", "tailorkit.package": "storage" },
        },
        () =>
          client.send(
            new DeleteObjectCommand({
              Bucket: options.bucket,
              Key: input.key,
            })
          )
      );
    },
    head: async (input: HeadObjectInput): Promise<HeadObjectOutput> => {
      const result = await withSpan(
        "storage.head",
        {
          attributes: { "storage.type": "s3", "tailorkit.package": "storage" },
        },
        () =>
          client.send(
            new HeadObjectCommand({
              Bucket: options.bucket,
              ChecksumMode: "ENABLED",
              Key: input.key,
            })
          )
      );

      return {
        checksumSha256: result.ChecksumSHA256,
        contentEncoding: result.ContentEncoding,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        key: input.key,
        metadata: result.Metadata,
      };
    },
    type: "s3",
  };
};
