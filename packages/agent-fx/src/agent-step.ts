import { runHarnessAgentStep } from "@ai-sdk/workflow-harness";
import type {
  HarnessWorkflowChunk,
  HarnessWorkflowState,
} from "@ai-sdk/workflow-harness";
import type { AppAgentInput } from "@tailorkit/agent/runtime";
import { getWritable } from "workflow";

/** Only this module loads the agent and Node-heavy sandbox adapter. */
export const agentStep = async (
  state: HarnessWorkflowState,
  input: AppAgentInput,
  runId: string
): Promise<HarnessWorkflowState> => {
  "use step";
  const { getSandbox, networkSession, renewSession, threadSandboxName } =
    await import("@tailorkit/agent/runtime");
  const { createAppAgent } = await import("./agent");
  await renewSession(input.appId, runId);
  const sandboxName = threadSandboxName(input.threadId);
  const sandbox = await getSandbox(sandboxName);
  const sandboxSession = await networkSession(sandbox);
  const agent = await createAppAgent(input, sandboxName);
  return await runHarnessAgentStep({
    agent,
    sandboxSession,
    state,
    writable: getWritable<HarnessWorkflowChunk>(),
  });
};
