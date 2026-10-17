import {
  prepareAppSandboxStep,
  runAppAgentTurn,
  stopAppSandboxStep,
} from "@tailorkit/agent/app-workflow";
import type { AppAgentInput } from "@tailorkit/agent/app-workflow";

import { agentStep } from "./agent-step";

export const appAgent = async (input: AppAgentInput) => {
  "use workflow";
  return await runAppAgentTurn(input, {
    harnessId: "fx",
    prepare: prepareAppSandboxStep,
    run: agentStep,
    stop: stopAppSandboxStep,
  });
};

export { cancelAppAgent } from "@tailorkit/agent/app-workflow";
export type { AppAgentInput } from "@tailorkit/agent/app-workflow";
