import { logger } from "@tailorkit/observability/logging";
import { getStepMetadata } from "workflow";

interface WorkflowLogContext {
  appId: string;
  runId: string;
  threadId?: string;
  phase?: "start" | "agent" | "finish" | "cancel";
  stepId?: string;
  attempt?: number;
  durationMs?: number;
  status?: string;
}

type WorkflowLogEvent =
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "cleanup_failed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "agent_checkpoint";

export const logWorkflowEvent = (
  event: WorkflowLogEvent,
  context: WorkflowLogContext,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Thrown values are an I/O boundary; only their error type is logged.
  error?: unknown
) => {
  // Allowlist fields: inputs, model output, resume state and error messages can
  // contain credentials or private app data. Inspect errors in Workflow instead.
  const attributes = {
    appId: context.appId,
    attempt: context.attempt,
    durationMs: context.durationMs,
    errorType: error instanceof Error ? error.name : undefined,
    phase: context.phase,
    runId: context.runId,
    status: context.status,
    stepId: context.stepId,
    threadId: context.threadId,
    workflow: "appAgent",
  };
  if (
    event === "run_failed" ||
    event === "step_failed" ||
    event === "cleanup_failed" ||
    context.status === "failed"
  ) {
    logger.error(event, attributes);
    return;
  }
  logger.info(event, attributes);
};

const stepMetadata = () => {
  try {
    const { attempt, stepId } = getStepMetadata();
    return { attempt, stepId };
  } catch {
    // cancelAppAgent also runs directly in API handlers, outside a Workflow step.
    return {};
  }
};

/** Run inside a "use step" function, so replay does not repeat its logs. */
export const withStepLogging = async <T>(
  context: WorkflowLogContext,
  operation: (context: WorkflowLogContext) => Promise<T>
): Promise<T> => {
  const stepContext = { ...context, ...stepMetadata() };
  const startedAt = Date.now();
  logWorkflowEvent("step_started", stepContext);
  try {
    const result = await operation(stepContext);
    logWorkflowEvent("step_completed", {
      ...stepContext,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logWorkflowEvent(
      "step_failed",
      { ...stepContext, durationMs: Date.now() - startedAt },
      error
    );
    throw error;
  }
};
