import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { emailOTPClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { ac, roles } from "@tailorkit/auth/lib/permissions";
import { dashClient } from "@better-auth/infra/client";
import { passkeyClient } from "@better-auth/passkey/client";

export function createAuthClient(headers: Record<string, unknown>) {
  return createBetterAuthClient({
    fetchOptions: { headers },
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
}
