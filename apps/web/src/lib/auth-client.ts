import { captchaEndpoints } from "@tailorkit/auth/lib/captcha-endpoints";
import { createAuthClient } from "@tailorkit/auth/client";
import { initBotId } from "botid/client/core";
import { deploymentHeaders } from "./deployment-headers";

// Better Auth captures fetch when creating the client, so install BotID first.
// Local development has no Vercel challenge proxy and the server allows requests.
if (typeof window !== "undefined" && import.meta.env.PROD) {
  initBotId({
    protect: captchaEndpoints.map((path) => ({ path: `/api/auth${path}`, method: "POST" })),
  });
}

export const authClient = createAuthClient(typeof window === "undefined" ? {} : deploymentHeaders);
