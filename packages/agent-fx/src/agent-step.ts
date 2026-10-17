import { runHarnessAgentStep } from "@ai-sdk/workflow-harness";
import type {
  HarnessWorkflowChunk,
  HarnessWorkflowState,
} from "@ai-sdk/workflow-harness";
import type { AppAgentInput } from "@tailorkit/agent/workflow-support";
import { getWritable } from "workflow";

/** Only this module loads the agent and Node-heavy sandbox adapter. */
export const agentStep = async (
  state: HarnessWorkflowState,
  input: AppAgentInput,
  runId: string
): Promise<HarnessWorkflowState> => {
  "use step";
  const {
    getSandbox,
    networkSession,
    removeLegacyAgentToken,
    renewSession,
    threadSandboxName,
  } = await import("@tailorkit/agent/runtime");
  // Existing Pi conversations retain their native journal; new threads use fx.
  const resumedHarness =
    state.continueFrom?.harnessId ?? state.resumeFrom?.harnessId;
  const { createAppAgent } = await (resumedHarness === "pi"
    ? import("@tailorkit/agent")
    : import("./agent"));
  await renewSession(input.appId, runId);
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
