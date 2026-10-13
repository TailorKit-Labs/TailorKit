import { z } from "zod";

/** Private platform/worker contract; never sent to application code. */
export const appDeploymentMetadata = z.object({
  appId: z.string().min(1).max(256),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  contentEncoding: z.literal("gzip").optional(),
  contentLength: z.number().int().positive(),
  deploymentId: z.string().min(1).max(256),
  objectKey: z.string().min(1).max(4096),
  projectId: z.string().min(1).max(256),
});
export type AppDeploymentMetadata = z.infer<typeof appDeploymentMetadata>;

export const deploymentMetadataKey = (identity: {
  projectId: string;
  appId: string;
}) => JSON.stringify([identity.projectId, identity.appId]);

/** The same service credential authenticates both directions, independent of user JWTs. */
export const runtimeServiceAuthorized = async (
  request: Request,
  secret: string | undefined
) => {
  const authorization = request.headers.get("authorization");
  if (
    !secret ||
    secret.length < 32 ||
    !authorization?.startsWith("Bearer ") ||
    authorization.length > 8192
  ) {
    return false;
  }
  const encoder = new TextEncoder();
  const [expected, supplied] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    crypto.subtle.digest("SHA-256", encoder.encode(authorization.slice(7))),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(supplied);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return difference === 0;
};
