import type { HarnessV1AuthenticationEnvironment } from "@ai-sdk/harness";
import { getVercelOidcToken } from "@vercel/oidc";
import { FatalError } from "workflow";

import { env } from "#env";

/** Resolve request-scoped credentials anew for each workflow execution. */
export const resolveAgentAuth =
  async (): Promise<HarnessV1AuthenticationEnvironment> => {
    if (env.AI_GATEWAY_API_KEY !== undefined) {
      return env;
    }

    try {
      // Production OIDC lives in the request context, not process.env.
      const token = await getVercelOidcToken();

      return { ...env, VERCEL_OIDC_TOKEN: token };
    } catch {
      if (
        env.VERCEL_OIDC_TOKEN !== undefined ||
        env.OPENAI_API_KEY !== undefined ||
        env.ANTHROPIC_API_KEY !== undefined
      ) {
        return env;
      }

      throw new FatalError(
        "App agent model authentication is unavailable. Enable Vercel OIDC for this deployment or set AI_GATEWAY_API_KEY in the platform environment."
      );
    }
  };
