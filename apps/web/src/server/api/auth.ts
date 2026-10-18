import { auth } from "@tailorkit/auth";
import {
  initializeObservability,
  setSpanAttributes,
} from "@tailorkit/observability";

import { createApiEntry } from "./entry";

export const handleAuthRequest = async ({ request }: { request: Request }) => {
  await initializeObservability("tailorkit-web");
  setSpanAttributes({
    "tailorkit.adapter": "better-auth",
    "tailorkit.package": "apps-web",
  });
  return await auth.handler(request);
};

export default createApiEntry(handleAuthRequest, ["GET", "POST"]);
