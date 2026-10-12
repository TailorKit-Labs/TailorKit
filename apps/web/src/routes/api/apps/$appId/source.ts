import { ORPCError, call } from "@orpc/server";
import { appRouter } from "@tailorkit/api/routers/index";
import { createContext } from "@tailorkit/api/context";
import { evaluateBooleanFlag } from "@tailorkit/flags";
import {
  AppAgentWorkspaceBusyError,
  exportAppAgentWorkspace,
  hasAppAgentWorkspace,
} from "@tailorkit/app-agent/source-export";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "../../../../env";

function response(status: number) {
  return new Response(null, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function errorStatus(error: unknown) {
  if (!(error instanceof ORPCError)) return 500;
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  return 500;
}

async function handle({ request, params }: { request: Request; params: { appId: string } }) {
  const url = new URL(request.url);
  const orgSlug = url.searchParams.get("orgSlug");
  const projectSlug = url.searchParams.get("projectSlug");
  if (!orgSlug || !projectSlug) return response(400);

  try {
    const context = await createContext({ request });
    const distinctId = context.user?.id;
    if (!distinctId) return response(401);

    const app = await call(
      appRouter.apps.get,
      { appId: params.appId, orgSlug, projectSlug },
      { context },
    );
    const enabled = await evaluateBooleanFlag("app-source-export", {
      defaultValue: false,
      distinctId,
      host: env.VITE_POSTHOG_HOST,
      projectApiKey: env.VITE_POSTHOG_PROJECT_TOKEN,
    });
    if (!enabled || !(await hasAppAgentWorkspace(app.id))) return response(404);

    if (request.method === "HEAD") return response(204);

    const archive = await exportAppAgentWorkspace(app.id);
    if (!archive) return response(404);

    return new Response(new Uint8Array(archive), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="tailorkit-app-${app.id}-source.tar.gz"`,
        "content-length": String(archive.byteLength),
        "content-type": "application/gzip",
      },
    });
  } catch (error) {
    if (error instanceof AppAgentWorkspaceBusyError) return response(409);
    return response(errorStatus(error));
  }
}

export const Route = createFileRoute("/api/apps/$appId/source")({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
    },
  },
});
