import {
  createHarnessWorkflowState,
  finalizeHarnessWorkflow,
} from "@ai-sdk/workflow-harness";
import { FatalError, getWorkflowMetadata } from "workflow";

import { agentStep } from "./agent-step";
import { threadSandboxName } from "./identity";
import type { AppAgentInput } from "./input";
import { prepareSandboxStep, stopSandboxStep } from "./sandbox";
import {
  cancelAppAgent,
  loadResumeStep,
  persistResumeStep,
  releaseSessionStep,
} from "./session-store";

/** A durable user turn; the thread identity resumes its own Pi conversation. */
export const appAgent = async (input: AppAgentInput) => {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  const deadline = Date.now() + 30 * 60_000;
  let completed = false;
  try {
    const saved = await loadResumeStep(input.appId, input.threadId, runId);
    await prepareSandboxStep(input, saved);
    let state = createHarnessWorkflowState({
      messages: input.messages,
      resumeFrom: saved.resumeFrom,
      sessionId: input.threadId,
    });
    do {
      if (Date.now() >= deadline) {
        throw new FatalError(
          "The app agent exceeded its 30-minute turn budget."
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Each checkpoint continues the preceding unfinished turn.
      state = await agentStep(state, input, runId);
    } while (state.status === "ready_for_next_step");

    const result = finalizeHarnessWorkflow(state);
    if (!state.resumeFrom) {
      throw new FatalError(
        "The app agent did not return resumable session state."
      );
    }
    await persistResumeStep(
      input.appId,
      input.threadId,
      runId,
      state.resumeFrom,
      threadSandboxName(input.threadId)
    );
    await stopSandboxStep(threadSandboxName(input.threadId));
    completed = true;
    return { ...result, threadId: input.threadId };
  } finally {
    await (completed
      ? releaseSessionStep(input.appId, runId)
      : cancelAppAgent(input.appId, runId));
  }
};

export { cancelAppAgent } from "./session-store";
export { deleteSandbox } from "./sandbox";
export type { AppAgentInput } from "./input";
