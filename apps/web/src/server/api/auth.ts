import { auth } from "@patchsmith/auth";
import {
  initializeObservability,
  setSpanAttributes,
} from "@patchsmith/observability";

import { createApiEntry } from "./entry";

export const handleAuthRequest = async ({ request }: { request: Request }) => {
  await initializeObservability("patchsmith-web");
  setSpanAttributes({
    "patchsmith.adapter": "better-auth",
    "patchsmith.package": "apps-web",
  });
  return await auth.handler(request);
};

export default createApiEntry(handleAuthRequest, ["GET", "POST"]);
