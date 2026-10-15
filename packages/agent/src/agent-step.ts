import { runHarnessAgentStep } from "@ai-sdk/workflow-harness";
import type {
  HarnessWorkflowChunk,
  HarnessWorkflowState,
} from "@ai-sdk/workflow-harness";
import { getWritable } from "workflow";

import type { AppAgentInput } from "./input";

/** Only this module loads the agent and Node-heavy sandbox adapter. */
export const agentStep = async (
  state: HarnessWorkflowState,
  input: AppAgentInput,
  runId: string
): Promise<HarnessWorkflowState> => {
  "use step";
  const { createAppAgent } = await import("./agent");
  const { getSandbox, networkSession, removeLegacyAgentToken } =
    await import("./sandbox");
  const { renewSession } = await import("./session-store");
  await renewSession(input.appId, runId);
  const { threadSandboxName } = await import("./identity");
  const sandboxName = threadSandboxName(input.threadId);
  const sandbox = await getSandbox(sandboxName);
  // Clean snapshots from older deployments before the shell can access them.
  await removeLegacyAgentToken(sandbox);
  const sandboxSession = await networkSession(sandbox);
  const agent = await createAppAgent(input, sandboxName);
  return await runHarnessAgentStep({
    agent,
    sandboxSession,
    state,
    writable: getWritable<HarnessWorkflowChunk>(),
  });
};
