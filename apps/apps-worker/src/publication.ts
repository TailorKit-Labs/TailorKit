import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";

/** Public URL identifiers must describe the same private bundle as the payload. */
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
    segments[3] !== publication.appShortId ||
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
