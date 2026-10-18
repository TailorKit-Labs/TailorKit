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

import type { S3CompatibleStorageOptions } from "./s3.js";
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

const createS3Client = (options: S3CompatibleStorageOptions): S3Client => {
  const config: S3ClientConfig = {
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    region: options.region ?? "auto",
  };

  if (
    options.accessKeyId !== undefined &&
    options.accessKeyId !== null &&
    options.accessKeyId !== "" &&
    options.secretAccessKey !== undefined &&
    options.secretAccessKey !== null &&
    options.secretAccessKey !== ""
  ) {
    config.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    };
  }

  return new S3Client(config);
};

export const createS3CompatibleStorage = (
  options: S3CompatibleStorageOptions
): Storage => {
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
          async () =>
            await getSignedUrl(client, command, {
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

      const headers: CreateUploadUrlOutput["headers"] = {};
      if (
        input.contentType !== undefined &&
        input.contentType !== null &&
        input.contentType !== ""
      ) {
        headers["content-type"] = input.contentType;
      }
      if (
        input.contentEncoding !== undefined &&
        input.contentEncoding !== null &&
        input.contentEncoding !== ""
      ) {
        headers["content-encoding"] = input.contentEncoding;
      }
      if (
        input.checksumSha256 !== undefined &&
        input.checksumSha256 !== null &&
        input.checksumSha256 !== ""
      ) {
        headers["x-amz-checksum-sha256"] = input.checksumSha256;
      }
      return {
        headers,
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
          async () =>
            await getSignedUrl(client, command, {
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
        async () =>
          await client.send(
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
        async () =>
          await client.send(
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
