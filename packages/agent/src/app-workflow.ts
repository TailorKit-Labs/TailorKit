import {
  createHarnessWorkflowState,
  finalizeHarnessWorkflow,
} from "@ai-sdk/workflow-harness";
import type { HarnessWorkflowState } from "@ai-sdk/workflow-harness";
import { FatalError, getWorkflowMetadata } from "workflow";

import { threadSandboxName } from "./identity";
import type { AppAgentHarness, AppAgentInput } from "./input";
import type { SavedAgentSession } from "./session-store";
import {
  cancelAppAgent,
  loadResumeStep,
  persistResumeStep,
  releaseSessionStep,
} from "./session-store";

interface AppTurnSteps {
  harnessId: AppAgentHarness;
  prepare: (input: AppAgentInput, saved: SavedAgentSession) => Promise<void>;
  run: (
    state: HarnessWorkflowState,
    input: AppAgentInput,
    runId: string
  ) => Promise<HarnessWorkflowState>;
  stop: (sandboxName: string) => Promise<void>;
}

/** Platform workspace ownership and persistence around an adapter's model steps. */
export const runAppAgentTurn = async (
  input: AppAgentInput,
  steps: AppTurnSteps
) => {
  const runId = getWorkflowMetadata().workflowRunId;
  const deadline = Date.now() + 30 * 60_000;
  let completed = false;
  try {
    const saved = await loadResumeStep(
      input.appId,
      input.threadId,
      runId,
      steps.harnessId
    );
    await steps.prepare(input, saved);
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
      state = await steps.run(state, input, runId);
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
    await steps.stop(threadSandboxName(input.threadId));
    completed = true;
    return { ...result, threadId: input.threadId };
  } finally {
    await (completed
      ? releaseSessionStep(input.appId, runId)
      : cancelAppAgent(input.appId, runId));
  }
};

export { cancelAppAgent } from "./session-store";
export { prepareAppSandboxStep, stopAppSandboxStep } from "./sandbox";
export type { AppAgentInput } from "./input";
