import {
  createHarnessWorkflowState,
  finalizeHarnessWorkflow,
} from "@ai-sdk/workflow-harness";
import type { ModelMessage } from "ai";
import { FatalError, getWorkflowMetadata } from "workflow";

import { agentStep } from "./agent-step";
import { appSandboxName } from "./identity";
import type { AppAgentInput } from "./input";
import { prepareSandboxStep, stopSandboxStep } from "./sandbox";
import {
  cancelAppAgent,
  loadResumeStep,
  persistResumeStep,
  releaseSessionStep,
} from "./session-store";

/** A durable user turn; the app identity resumes the same Pi conversation. */
export const appAgent = async (input: AppAgentInput) => {
  "use workflow";
  const runId = getWorkflowMetadata().workflowRunId;
  const deadline = Date.now() + 30 * 60_000;
  let completed = false;
  try {
    const saved = await loadResumeStep(input.appId, runId);
    await prepareSandboxStep(input, saved);
    let state = createHarnessWorkflowState({
      messages: input.messages,
      resumeFrom: saved.resumeFrom,
      sessionId: input.appId,
    });
    const messages: ModelMessage[] = [];
    do {
      if (Date.now() >= deadline) {
        throw new FatalError(
          "The app agent exceeded its 30-minute turn budget."
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Each checkpoint continues the preceding unfinished turn.
      const result = await agentStep(state, input, runId);
      ({ state } = result);
      messages.push(...result.messages);
    } while (state.status === "ready_for_next_step");

    const result = finalizeHarnessWorkflow(state);
    if (!state.resumeFrom) {
      throw new FatalError(
        "The app agent did not return resumable session state."
      );
    }
    await persistResumeStep(
      input.appId,
      runId,
      state.resumeFrom,
      appSandboxName(input.appId)
    );
    await stopSandboxStep(appSandboxName(input.appId));
    completed = true;
    return { ...result, messages };
  } finally {
    await (completed
      ? releaseSessionStep(input.appId, runId)
      : cancelAppAgent(input.appId, runId));
  }
};

export { cancelAppAgent } from "./session-store";
export { deleteSandbox } from "./sandbox";
export type { AppAgentInput } from "./input";
