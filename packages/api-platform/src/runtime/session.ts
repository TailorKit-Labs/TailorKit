import { ORPCError } from "@orpc/server";
import type { AppTokenIdentity } from "@patchsmith/api-utils/app-auth";
import type { App, AppDeployment } from "@patchsmith/db/schema/apps";
import { z } from "zod";

import { scopeSchema } from "#scope";

export const runtimeViewerSchema = z.object({
  subjectId: z.string().min(1).max(256),
  toolUrl: z.url().refine((value) => {
    const url = new URL(value);

    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "Tool URL requires HTTPS"),
});

export const runtimeSessionSchema = z.object({
  expiresAt: z.number(),
  identity: z.object({
    appId: z.string(),
    appShortId: z.string(),
    deploymentId: z.string(),
    expiresAt: z.number(),
    installationId: z.string(),
    projectId: z.string(),
    projectShortId: z.string(),
    scope: scopeSchema,
    subjectId: z.string().min(1).max(256),
    toolUrl: z.url(),
  }),
  token: z.string(),
  url: z.url(),
});

export type RuntimeApp = Pick<
  z.infer<typeof App>,
  "id" | "shortId" | "scope"
> & {
  currentDeployment: Pick<z.infer<typeof AppDeployment>, "id"> | null;
};

/** Reuse the already authorized discovery row instead of looking up each app again. */
export const createRuntimeSessionWith = async (
  context: { project: { id: string; shortId: string } },
  app: RuntimeApp,
  input: z.infer<typeof runtimeViewerSchema>,
  options: {
    assetDomain: string;
    runtimeUrl?: string;
    issueToken: (
      identity: AppTokenIdentity
    ) => Promise<{ token: string; expiresAt: number }>;
  }
) => {
  const deployment = app.currentDeployment;

  if (!deployment) {
    throw new ORPCError("NOT_FOUND", {
      message: "App has no published deployment.",
    });
  }

  const runtime = new URL(
    options.runtimeUrl ??
      `https://${context.project.shortId}.${options.assetDomain}`
  );

  const localRuntime =
    runtime.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(runtime.hostname);

  if (
    runtime.username ||
    runtime.password ||
    runtime.search ||
    runtime.hash ||
    (runtime.protocol !== "https:" && !localRuntime)
  ) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Invalid app runtime configuration.",
    });
  }

  const projectPath = localRuntime ? `/p/${context.project.shortId}` : "";
  const url = new URL(`${projectPath}/a/${app.shortId}/rpc`, runtime);

  // Each app belongs to one installation scope. Resolve identity from the authorized
  // database record, never from browser input or the ordering of the viewer's scopes.
  const identity = {
    appId: app.id,
    appShortId: app.shortId,
    deploymentId: deployment.id,
    installationId: app.id,
    projectId: context.project.id,
    projectShortId: context.project.shortId,
    scope: app.scope,
    subjectId: input.subjectId,
    toolUrl: input.toolUrl,
  };

  const session = await options.issueToken(identity);

  return {
    ...session,
    identity: { ...identity, expiresAt: session.expiresAt },
    url: url.href,
  };
};
