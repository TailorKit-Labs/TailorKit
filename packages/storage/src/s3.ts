import type { Storage } from "./types.js";

export interface S3CompatibleStorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export const createS3CompatibleStorage = (
  options: S3CompatibleStorageOptions
): Storage => {
  let instance: Promise<Storage> | undefined;

  const loadStorage = async (): Promise<Storage> => {
    try {
      const { createS3CompatibleStorage: createStorage } =
        await import("./s3-client.js");
      return createStorage(options);
    } catch (error) {
      instance = undefined;
      throw error;
    }
  };

  const getStorage = async (): Promise<Storage> => {
    instance ??= loadStorage();
    return await instance;
  };

  return {
    createDownloadUrl: async (input) => {
      const storage = await getStorage();
      return await storage.createDownloadUrl(input);
    },
    createUploadUrl: async (input) => {
      const storage = await getStorage();
      return await storage.createUploadUrl(input);
    },
    delete: async (input) => {
      const storage = await getStorage();
      await storage.delete(input);
    },
    head: async (input) => {
      const storage = await getStorage();
      return await storage.head(input);
    },
    type: "s3",
  };
};
