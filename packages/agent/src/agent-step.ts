import { runHarnessAgentTimeSlice } from "@ai-sdk/workflow-harness";
import type {
  HarnessWorkflowAgent,
  HarnessWorkflowChunk,
  HarnessWorkflowState,
} from "@ai-sdk/workflow-harness";
import type { ModelMessage } from "ai";
import { getWritable } from "workflow";

import type { AppAgentInput } from "./input";

export interface AgentStepResult {
  state: HarnessWorkflowState;
  messages: ModelMessage[];
}

/** Only this module loads the agent and Node-heavy sandbox adapter. */
export const agentStep = async (
  state: HarnessWorkflowState,
  input: AppAgentInput,
  runId: string
): Promise<AgentStepResult> => {
  "use step";
  const { createAppAgent } = await import("./agent");
  const { getSandbox, networkSession, writeAgentToken } =
    await import("./sandbox");
  const { renewSession } = await import("./session-store");
  await renewSession(input.appId, runId);
  const { appSandboxName } = await import("./identity");
  const sandboxName = appSandboxName(input.appId);
  const sandboxSession = await networkSession(await getSandbox(sandboxName));
  // A resumed persistent VM may have dropped the ephemeral token file.
  await writeAgentToken(sandboxName, input.agentToken);
  const agent = await createAppAgent(input, sandboxName);
  let result: Awaited<ReturnType<typeof agent.stream>> | undefined;
  const runner: HarnessWorkflowAgent = {
    continueStream: async (options) => {
      result = await agent.continueStream(options);
      return result;
    },
    createSession: async (options) => await agent.createSession(options),
    stream: async (options) => {
      result = await agent.stream(options);
      return result;
    },
  };
  const next = await runHarnessAgentTimeSlice({
    agent: runner,
    sandboxSession,
    state,
    timeSliceSeconds: 300,
    writable: getWritable<HarnessWorkflowChunk>(),
  });
  const messages = result
    ? await Promise.resolve(result.responseMessages).catch(() => [])
    : [];
  return { messages, state: next };
};
