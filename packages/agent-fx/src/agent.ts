import { createFx } from "@ai-sdk/harness-fx";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { appAgentSettings } from "@tailorkit/agent/runtime";
import type { AppAgentInput } from "@tailorkit/agent/runtime";
import { getVercelOidcToken } from "@vercel/oidc";
import { isStepCount } from "ai";
import { FatalError } from "workflow";

import { env } from "#env";

/** Resolve host credentials for every slice without persisting them in sessions. */
const resolveAuth = async () => {
  if (env.AI_GATEWAY_API_KEY !== undefined) {
    return env;
  }
  try {
    return { ...env, VERCEL_OIDC_TOKEN: await getVercelOidcToken() };
  } catch {
    if (env.VERCEL_OIDC_TOKEN !== undefined) {
      return env;
    }
    throw new FatalError(
      "fx requires AI_GATEWAY_API_KEY or Vercel OIDC in the platform environment."
    );
  }
};

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
      auth: await resolveAuth(),
    }),
    stopWhen: isStepCount(1),
  });
