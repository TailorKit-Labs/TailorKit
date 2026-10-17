import { agentStep } from "./agent-step";
import { runAppAgentTurn } from "./app-workflow";
import type { AppAgentInput } from "./input";
import { prepareSandboxStep, stopSandboxStep } from "./sandbox";

export const appAgent = async (input: AppAgentInput) => {
  "use workflow";
  return await runAppAgentTurn(input, {
    harnessId: "pi",
    prepare: prepareSandboxStep,
    run: agentStep,
    stop: stopSandboxStep,
  });
};

export { cancelAppAgent } from "./session-store";
export { deleteSandbox } from "./sandbox";
export type { AppAgentInput } from "./input";
