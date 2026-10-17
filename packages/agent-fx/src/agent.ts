import { createFx } from "@ai-sdk/harness-fx";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { appAgentSettings } from "@tailorkit/agent/runtime";
import type { AppAgentInput } from "@tailorkit/agent/runtime";
import { getVercelOidcToken } from "@vercel/oidc";
import { isStepCount } from "ai";

import { env } from "#env";

/** Stock fx tools and runtime, with TailorKit instructions, skills, and publication. */
export const createAppAgent = async (
  input: AppAgentInput,
  sandboxName: string
): Promise<
  HarnessAgent<
    ReturnType<typeof createFx>,
    ReturnType<typeof appAgentSettings>["tools"]
  >
> =>
  new HarnessAgent({
    ...appAgentSettings(input, sandboxName),
    harness: createFx({
      auth:
        env.AI_GATEWAY_API_KEY === undefined
          ? {
              ...env,
              VERCEL_OIDC_TOKEN: await getVercelOidcToken().catch(
                () => env.VERCEL_OIDC_TOKEN
              ),
            }
          : env,
    }),
    stopWhen: isStepCount(1),
  });
