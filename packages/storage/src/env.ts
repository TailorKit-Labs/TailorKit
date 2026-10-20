import { createEnv, warnIfMissing } from "@patchsmith/env";
import * as z from "zod";

export const env = createEnv({
  schema: {
    BLOB_ACCESS_KEY_ID: z.string().min(1).optional(),
    BLOB_BUCKET: z.string().min(1).optional(),
    BLOB_ENDPOINT: z.url().optional(),
    BLOB_FORCE_PATH_STYLE: z.stringbool().optional(),
    BLOB_REGION: z.string().min(1).optional(),
    BLOB_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  },
  scope: "storage",
});

if (
  env.BLOB_BUCKET !== undefined &&
  env.BLOB_BUCKET !== null &&
  env.BLOB_BUCKET !== ""
) {
  warnIfMissing("storage", {
    BLOB_ACCESS_KEY_ID: env.BLOB_ACCESS_KEY_ID,
    BLOB_SECRET_ACCESS_KEY: env.BLOB_SECRET_ACCESS_KEY,
  });
}
