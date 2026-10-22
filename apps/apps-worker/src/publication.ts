import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";

/** A target installation may use another app’s bundle; verify project and private path shape. */
export const validateDeploymentPublication = (
  metadata: AppDeploymentMetadata,
  publication: { projectId: string; appShortId: string }
): void => {
  const segments = metadata.objectKey.split("/");

  if (
    metadata.projectId !== publication.projectId ||
    segments.length !== 8 ||
    segments[0] !== "projects" ||
    !/^[a-z0-9]{12}$/u.test(segments[1] ?? "") ||
    segments[2] !== "apps" ||
    !/^[a-z0-9]{12}$/u.test(segments[3] ?? "") ||
    segments[4] !== "deployments" ||
    !/^[a-z0-9]{12}$/u.test(segments[5] ?? "") ||
    segments[6] !== "server" ||
    segments[7] !== "server.js"
  ) {
    throw new AppError(
      "BAD_REQUEST",
      "Deployment metadata does not match the route"
    );
  }
};
