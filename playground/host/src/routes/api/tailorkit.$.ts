import { authenticateTailorKitRequest, tailorKit } from "#lib/tailorkit-server";
import { createFileRoute } from "@tanstack/react-router";

const handle = ({ request }: { request: Request }) =>
  tailorKit.handler(request, { authenticate: authenticateTailorKitRequest });

export const Route = createFileRoute("/api/tailorkit/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
