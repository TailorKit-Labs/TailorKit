import { createFileRoute } from "@tanstack/react-router";

import {
  authenticatePatchSmithRequest,
  patchSmith,
} from "#lib/patchsmith-server";

const handle = async ({ request }: { request: Request }) =>
  await patchSmith.handler(request, {
    authenticate: authenticatePatchSmithRequest,
  });

export const Route = createFileRoute("/api/patchsmith/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
