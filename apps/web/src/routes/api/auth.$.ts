import { auth } from "@tailorkit/auth";
import {
  initializeObservability,
  setSpanAttributes,
} from "@tailorkit/observability";
import { createFileRoute } from "@tanstack/react-router";

const handleAuthRequest = async (request: Request) => {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "better-auth",
    "tailorkit.package": "apps-web",
  });
  return await auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleAuthRequest(request),
      POST: async ({ request }) => await handleAuthRequest(request),
    },
  },
});
