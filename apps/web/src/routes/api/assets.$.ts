import { handleAssetRequest } from "@tailorkit/api-platform/assets";
import { getStorage } from "@tailorkit/storage";
import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request }: { request: Request }) =>
  await handleAssetRequest(request, getStorage());

export const Route = createFileRoute("/api/assets/$")({
  server: {
    handlers: {
      DELETE: handle,
      GET: handle,
      HEAD: handle,
      OPTIONS: handle,
      PATCH: handle,
      POST: handle,
      PUT: handle,
    },
  },
});
