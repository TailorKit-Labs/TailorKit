import type { HarnessV1ResumeSessionState } from "@ai-sdk/harness";
import {
  createHarnessWorkflowState,
  finalizeHarnessWorkflow,
} from "@ai-sdk/workflow-harness";
import { FatalError, getWorkflowMetadata } from "workflow";

import { agentStep } from "./agent-step";
import type { AppAgentInput } from "./input";

const start = async (input: AppAgentInput, runId: string) => {
  "use step";
  const { startTurn } = await import("./session");
  return await startTurn(input, runId);
};
const finish = async (
  input: AppAgentInput,
  runId: string,
  resumeFrom: HarnessV1ResumeSessionState
) => {
  "use step";
  const { finishTurn } = await import("./session");
  await finishTurn(input, runId, resumeFrom);
};
export const cancelAppAgent = async (appId: string, runId: string) => {
  "use step";
  const { cancelTurn } = await import("./session");
  await cancelTurn(appId, runId);
};

/** One durable step per model step, using fx's own session checkpoints. */
export const appAgent = async (input: AppAgentInput) => {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  const deadline = Date.now() + 30 * 60_000;
  try {
    const resumeFrom = await start(input, runId);
    let state = createHarnessWorkflowState({
      messages: input.messages,
      resumeFrom,
      sessionId: input.threadId,
    });
    do {
      if (Date.now() >= deadline) {
        throw new FatalError(
          "The app agent exceeded its 30-minute turn budget."
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Each model step continues the preceding checkpoint.
      state = await agentStep(state, input, runId);
    } while (state.status === "ready_for_next_step");
    const result = finalizeHarnessWorkflow(state);
    if (!state.resumeFrom) {
      throw new FatalError("fx did not return resumable session state.");
    }
    await finish(input, runId, state.resumeFrom);
    return { ...result, threadId: input.threadId };
  } catch (error) {
    await cancelAppAgent(input.appId, runId);
    throw error;
  }
};
