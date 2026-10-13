import { env } from "#env";

import { createS3CompatibleStorage } from "./s3.js";
import type { Storage } from "./types.js";

type StorageInstance = Storage | null;

let instance: StorageInstance | undefined;

const createStorage = (): StorageInstance => {
  if (
    !(
      env.BLOB_BUCKET !== undefined &&
      env.BLOB_BUCKET !== null &&
      env.BLOB_BUCKET !== ""
    )
  ) {
    return null;
  }

  return createS3CompatibleStorage({
    accessKeyId: env.BLOB_ACCESS_KEY_ID,
    bucket: env.BLOB_BUCKET,
    endpoint: env.BLOB_ENDPOINT,
    forcePathStyle: env.BLOB_FORCE_PATH_STYLE ?? Boolean(env.BLOB_ENDPOINT),
    region: env.BLOB_REGION,
    secretAccessKey: env.BLOB_SECRET_ACCESS_KEY,
  });
};

export const getStorage = (): StorageInstance => {
  if (instance !== undefined) {
    return instance;
  }

  instance = createStorage();
  return instance;
};
