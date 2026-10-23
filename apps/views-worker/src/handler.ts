import { COMMON_ERROR_STATUS_MAP, ORPCError } from "@orpc/server";
import { discoverApps } from "@patchsmith/api-platform/runtime/discovery";
import {
  resolveAppViews,
  runtimeResolveInput,
  runtimeResolveOutput,
} from "@patchsmith/api-platform/runtime/resolve";
import { createRuntimeSessionWith } from "@patchsmith/api-platform/runtime/session";
import { canonicalizeScopes } from "@patchsmith/api-platform/scope";
import { withAppAssetUrl } from "@patchsmith/api-utils/app-asset-url";
import { APP_AUDIENCE, issueAppToken } from "@patchsmith/api-utils/app-auth";
import type { AppSigningOptions } from "@patchsmith/api-utils/app-auth";
import type { createProjectHostVerifier } from "@patchsmith/auth/project-host";
import { Effect } from "effect";
import { z } from "zod";

import { installationTransport } from "./runtime";
import type { InstallationNamespace } from "./runtime";

export const resolutionPath = "/api/platform/apps/runtime/resolve";

const errorStatuses: Readonly<Record<string, number>> = COMMON_ERROR_STATUS_MAP;

export const errorResponse = (
  error: Pick<ORPCError<string, undefined>, "code" | "defined" | "message">
) =>
  Response.json(
    {
      code: error.code,
      defined: error.defined,
      message: error.message,
    },
    {
      headers: { "cache-control": "no-store" },
      status: errorStatuses[error.code] ?? 500,
    }
  );

interface Services {
  database: Parameters<typeof discoverApps>[0];
  verifyKey: (
    key: string
  ) => ReturnType<
    ReturnType<typeof createProjectHostVerifier>["api"]["verifyApiKey"]
  >;
  limit: (organizationId: string) => Promise<boolean>;
  signing: Omit<AppSigningOptions, "audience">;
  assetDomain: string;
  stores: InstallationNamespace;
}

const metadata = z.object({ projectId: z.uuid() });

/** JSON size is bounded before parsing or opening a database connection. */
export const readInput = async (request: Request) => {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new ORPCError("BAD_REQUEST");
  }

  const decoder = new TextDecoder();
  let text = "";
  let length = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- A stream must be read sequentially to enforce the byte limit before requesting the next chunk.
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      length += chunk.value.byteLength;

      if (length > 1_048_576) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Cancel immediately at the size boundary before any additional allocation.
        await reader.cancel();
        throw new ORPCError("PAYLOAD_TOO_LARGE");
      }

      text += decoder.decode(chunk.value, { stream: true });
    }

    text += decoder.decode();

    const input = runtimeResolveInput.parse(JSON.parse(text));
    canonicalizeScopes(input.scopes);

    return input;
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid view resolution input",
    });
  } finally {
    reader.releaseLock();
  }
};

export const projectKey = (request: Request) => {
  const header = request.headers.get("authorization");

  if (header?.startsWith("Bearer tk_proj_") !== true || header.length > 8192) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return header.slice(7);
};

export const resolveRequest = async (
  request: Request,
  input: z.infer<typeof runtimeResolveInput>,
  services: Services
) => {
  const started = performance.now();
  const result = await services.verifyKey(projectKey(request));

  if (!result.valid || !result.key) {
    const limited = ["RATE_LIMITED", "USAGE_EXCEEDED"].includes(
      result.error?.code ?? ""
    );

    throw new ORPCError(limited ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED");
  }

  const projectId = metadata.safeParse(result.key.metadata).data?.projectId;

  if (projectId === undefined) {
    throw new ORPCError("UNAUTHORIZED");
  }

  const project = await services.database.query.project.findFirst({
    where: { id: projectId },
    with: { organization: true },
  });

  if (!project || project.organizationId !== result.key.referenceId) {
    throw new ORPCError("UNAUTHORIZED");
  }

  if (!(await services.limit(project.organizationId))) {
    throw new ORPCError("TOO_MANY_REQUESTS");
  }

  const authMs = performance.now() - started;

  const transport = installationTransport(
    services.stores,
    services.signing.issuer
  );

  return await Effect.runPromise(
    resolveAppViews(input, {
      assets: (app) =>
        withAppAssetUrl(app, project.shortId, {
          assetDomain: services.assetDomain,
        }),
      discover: async (body) =>
        await discoverApps(services.database, project.id, body),
      fetch: transport.fetch,
      session: async (app, body) =>
        transport.register(
          await createRuntimeSessionWith({ project }, app, body, {
            assetDomain: services.assetDomain,
            issueToken: async (identity) =>
              await issueAppToken(
                { ...services.signing, audience: APP_AUDIENCE },
                identity
              ),
          })
        ),
    }).pipe(
      Effect.match({
        onFailure: errorResponse,
        onSuccess: (output) => {
          const { body, headers } = runtimeResolveOutput.parse(output);

          return Response.json(body, {
            headers: {
              ...headers,
              "server-timing": `${headers["server-timing"]}, platform_auth;dur=${authMs.toFixed(1)}, platform_total;dur=${(performance.now() - started).toFixed(1)}`,
            },
          });
        },
      })
    ),
    { signal: request.signal }
  );
};
