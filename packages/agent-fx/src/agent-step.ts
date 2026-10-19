import { runHarnessAgentStep } from "@ai-sdk/workflow-harness";
import type {
  HarnessWorkflowChunk,
  HarnessWorkflowState,
} from "@ai-sdk/workflow-harness";
import { getWritable } from "workflow";

import type { AppAgentInput } from "./input";
import { logWorkflowEvent, withStepLogging } from "./logging";

export const agentStep = async (
  state: HarnessWorkflowState,
  input: AppAgentInput,
  runId: string
): Promise<HarnessWorkflowState> => {
  "use step";
  return await withStepLogging(
    { appId: input.appId, phase: "agent", runId, threadId: input.threadId },
    async (context) => {
      const { createAppAgent } = await import("./agent");
      const { assertOwnership } = await import("./session");
      const { getSandbox, sandboxName, sandboxSession } =
        await import("./sandbox");
      await assertOwnership(input.appId, runId);
      const name = sandboxName(input.threadId);
      const result = await runHarnessAgentStep({
        agent: await createAppAgent(input, name),
        sandboxSession: sandboxSession(await getSandbox(name)),
        state,
        writable: getWritable<HarnessWorkflowChunk>(),
      });
      logWorkflowEvent("agent_checkpoint", {
        ...context,
        status: result.status,
      });
      return result;
    }
  );
};
