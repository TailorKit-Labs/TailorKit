import { dashClient } from "@better-auth/infra/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { captchaEndpoints } from "@patchsmith/auth/lib/captcha-endpoints";
import { ac, roles } from "@patchsmith/auth/lib/permissions";
import {
  emailOTPClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { initBotId } from "botid/client/core";

import { deploymentHeaders } from "./deployment-headers";

// Better Auth captures fetch when creating the client, so install BotID first.
// Local development has no Vercel challenge proxy and the server allows requests.
if (typeof window !== "undefined" && import.meta.env.PROD) {
  initBotId({
    protect: captchaEndpoints.map((path) => ({
      method: "POST",
      path: `/api/auth${path}`,
    })),
  });
}

export const authClient = createAuthClient({
  fetchOptions: {
    headers: typeof window === "undefined" ? {} : deploymentHeaders,
  },
  plugins: [
    dashClient(),
    passkeyClient(),
    emailOTPClient(),
    twoFactorClient({
      twoFactorPage: "/two-factor",
    }),
    organizationClient({
      ac,
      roles,
    }),
  ],
});
