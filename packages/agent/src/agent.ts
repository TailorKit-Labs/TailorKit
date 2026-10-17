import { createPi } from "@ai-sdk/harness-pi";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { isStepCount } from "ai";

import { resolveAgentAuth } from "./agent-auth";
import { appAgentSettings } from "./app-settings";
import { gatewayModelProviders } from "./gateway-model";
import type { AppAgentInput } from "./input";

/** Configuration only; live state belongs to the supplied harness session. */
export const createAppAgent = async (
  input: AppAgentInput,
  sandboxName: string
) => {
  const auth = await resolveAgentAuth();
  const providers = gatewayModelProviders(input.model, auth);

  return new HarnessAgent({
    harness: createPi({
      auth,
      fileToolPathPolicy: {
        readableRoots: ["/tmp/tailorkit-cli", "/workspace"],
      },
      providers,
      reattachInProcess: false,
      thinkingLevel: input.model === "openai/gpt-6.1-sol" ? "low" : "medium",
    }),
    ...appAgentSettings(input, sandboxName),
    stopWhen: isStepCount(1),
  });
};

export type { AppAgentInput } from "./input";
