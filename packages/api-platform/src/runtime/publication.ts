import type { AppDeploymentMetadata } from "@patchsmith/api-utils/app-auth";

import { env } from "#env";

/** The service credential stays in the host; warming never invokes app handlers. */
export const warmRuntimeInstallation = async (
  metadata: AppDeploymentMetadata,
  appShortId: string
) => {
  const token = env.APP_RUNTIME_SERVICE_TOKEN;

  if (token === undefined || token === "") {
    return;
  }

  const url = new URL(
    `/p/${metadata.projectId}/a/${appShortId}/new-deployment`,
    env.APP_RUNTIME_INTERNAL_URL ??
      `https://internal.${env.ASSET_DOMAIN ?? "tailorkit.app"}`
  );

  if (url.protocol !== "https:") {
    throw new Error("App runtime URL requires HTTPS");
  }

  const response = await fetch(url, {
    body: JSON.stringify(metadata),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Runtime warm-up failed (${response.status})`);
  }
};
