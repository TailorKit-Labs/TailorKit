import { stripVTControlCharacters } from "node:util";

import type { UIMessageChunk } from "ai";
import { z } from "zod";

interface AppAgentMcpRun {
  appId: string;
  runId: string;
  threadId: string;
}

/** Internal events supplied by the backend, never forwarded directly to clients. */
export type AppAgentMcpProgress = AppAgentMcpRun &
  ({ status: "started" } | { chunk: UIMessageChunk; status: "streaming" });

/** Version 2 activity snapshots carried in progress notification metadata. */
export type AppAgentMcpActivity = AppAgentMcpRun &
  (
    | { status: "started" | "error" | "aborted" | "finishing" }
    | { status: "text"; text: string }
    | (ToolAction & {
        outcome: "running" | "completed" | "failed" | "denied";
        status: "tool";
        toolCallId: string;
      })
  );

interface ProgressSnapshot {
  activity: AppAgentMcpActivity;
  message: string;
}

const maximumPreviewLength = 320;
const whitespace = /\s+/gu;
const controlCharacters = /[\p{Cc}\p{Cf}]/gu;
const credentialMarkers =
  /password|passwd|secret|token|authorization|credential|cookie|bearer|(?:api|access|private)[_-]?key|https?:\/\/[^/\s]+@|(?:^|\s)(?:-u|--user)(?:[\s=]|$)/iu;

const preview = (value: string): string => {
  const text = stripVTControlCharacters(value)
    .replaceAll(whitespace, " ")
    .replaceAll(controlCharacters, "")
    .trim();
  return text.length > maximumPreviewLength
    ? `${text.slice(0, maximumPreviewLength - 1)}…`
    : text;
};

const toolInputSchema = z.object({
  command: z.string().optional(),
  file_path: z.string().optional(),
  path: z.string().optional(),
  pattern: z.string().optional(),
});
interface ToolAction {
  detail?: string;
  label: string;
}
const toolLabels = new Map([
  ["bash", "Bash"],
  ["deploy", "Deploy"],
  ["edit", "Edit"],
  ["glob", "Find files"],
  ["grep", "Grep"],
  ["ls", "List files"],
  ["read", "Read"],
  ["write", "Write"],
]);

const toolAction = (
  chunk: Extract<
    UIMessageChunk,
    { type: "tool-input-start" | "tool-input-available" | "tool-input-error" }
  >
): ToolAction => {
  const label = toolLabels.get(chunk.toolName);
  if (label === undefined) {
    const name = preview(chunk.toolName);
    return name === "" ? { label: "Tool" } : { detail: name, label: "Tool" };
  }
  if (chunk.toolName === "deploy") {
    return { detail: "type-checking, building, and publishing app", label };
  }
  if (chunk.type === "tool-input-start") {
    return { label };
  }
  const parsed = toolInputSchema.safeParse(chunk.input);
  if (!parsed.success) {
    return { label };
  }
  const { command, file_path: filePath, path, pattern } = parsed.data;
  if (chunk.toolName === "bash" && command !== undefined) {
    const detail = credentialMarkers.test(command)
      ? "[command with credential markers hidden]"
      : preview(command);
    return { detail, label };
  }
  if (["read", "write", "edit", "ls"].includes(chunk.toolName)) {
    return { detail: preview(filePath ?? path ?? "."), label };
  }
  if (["grep", "glob"].includes(chunk.toolName) && pattern !== undefined) {
    return { detail: preview(`${pattern} in ${path ?? "."}`), label };
  }
  return { label };
};

const describeTool = (action: ToolAction): string =>
  preview(
    action.detail === undefined
      ? `${action.label}.`
      : `${action.label}: ${action.detail}`
  );

const toolOutputSchema = z.object({
  exitCode: z.number().optional(),
  isError: z.boolean().optional(),
});

type ToolOutcome = Extract<AppAgentMcpActivity, { status: "tool" }>["outcome"];

const toolSnapshot = (
  run: AppAgentMcpRun,
  action: ToolAction,
  toolCallId: string,
  outcome: ToolOutcome
): ProgressSnapshot => ({
  activity: { ...run, ...action, outcome, status: "tool", toolCallId },
  message:
    outcome === "running"
      ? describeTool(action)
      : preview(`${outcome}: ${describeTool(action)}`),
});

const toolOutcome = (
  chunk: Extract<
    UIMessageChunk,
    {
      type:
        | "tool-output-available"
        | "tool-output-error"
        | "tool-output-denied";
    }
  >
): ToolOutcome => {
  if (chunk.type === "tool-output-denied") {
    return "denied";
  }
  if (chunk.type === "tool-output-error") {
    return "failed";
  }
  const output = toolOutputSchema.safeParse(chunk.output);
  const failed =
    output.success &&
    (output.data.isError === true ||
      (output.data.exitCode !== undefined && output.data.exitCode !== 0));
  return failed ? "failed" : "completed";
};

/** Reduce internal chunks to bounded, human-readable activity snapshots. */
export const createProgressSnapshot = () => {
  const text = new Map<string, string>();
  const tools = new Map<string, ToolAction>();

  return (event: AppAgentMcpProgress): ProgressSnapshot | undefined => {
    const { appId, runId, threadId } = event;
    const run = { appId, runId, threadId };
    if (event.status === "started") {
      return {
        activity: { ...run, status: "started" },
        message: preview(`App agent started for app ${appId}.`),
      };
    }
    const { chunk } = event;
    if (chunk.type === "text-delta") {
      const combined = `${text.get(chunk.id) ?? ""}${chunk.delta}`;
      const current =
        combined.length > maximumPreviewLength
          ? `…${combined.slice(-(maximumPreviewLength - 1))}`
          : combined;
      text.set(chunk.id, current);
      const message = preview(current);
      return message === ""
        ? undefined
        : { activity: { ...run, status: "text", text: message }, message };
    }
    if (chunk.type === "text-end") {
      text.delete(chunk.id);
    }
    if (
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error"
    ) {
      const action = toolAction(chunk);
      tools.set(chunk.toolCallId, action);
      const outcome = chunk.type === "tool-input-error" ? "failed" : "running";
      return toolSnapshot(run, action, chunk.toolCallId, outcome);
    }
    if (
      chunk.type === "tool-output-available" ||
      chunk.type === "tool-output-error" ||
      chunk.type === "tool-output-denied"
    ) {
      if (
        chunk.type === "tool-output-available" &&
        chunk.preliminary === true
      ) {
        return undefined;
      }
      const action = tools.get(chunk.toolCallId) ?? { label: "Tool" };
      tools.delete(chunk.toolCallId);
      return toolSnapshot(run, action, chunk.toolCallId, toolOutcome(chunk));
    }
    if (chunk.type === "error") {
      return {
        activity: { ...run, status: "error" },
        message:
          "App agent encountered an error. Check the app before retrying.",
      };
    }
    if (chunk.type === "abort") {
      return {
        activity: { ...run, status: "aborted" },
        message: "App agent stopped. Check the app before repeating a change.",
      };
    }
    if (chunk.type === "finish") {
      return {
        activity: { ...run, status: "finishing" },
        message: "App agent finished generating; waiting for workflow cleanup.",
      };
    }
    return undefined;
  };
};

const textIntervalMs = 750;
const heartbeatIntervalMs = 15_000;

/** Serialize notifications, coalesce text, and release timers when a call ends. */
export const createProgressReporter = (
  notify: (snapshot: ProgressSnapshot) => Promise<void>,
  signal: AbortSignal
) => {
  const snapshot = createProgressSnapshot();
  let queue = Promise.resolve();
  let latest: ProgressSnapshot | undefined;
  let pendingText: ProgressSnapshot | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTextAt = -textIntervalMs;
  let closed = false;
  let failure: Error | undefined;

  const close = () => {
    closed = true;
    clearTimeout(textTimer);
    clearTimeout(heartbeatTimer);
    pendingText = undefined;
    signal.removeEventListener("abort", close);
  };

  const send = async (update: ProgressSnapshot): Promise<void> => {
    latest = update;
    clearTimeout(heartbeatTimer);
    const previous = queue;
    const delivered = (async () => {
      await previous;
      signal.throwIfAborted();
      if (failure !== undefined) {
        throw failure;
      }
      await notify(update);
    })();
    // Observe background failures without rejecting the serialization queue.
    // The next backend update or final flush still reports the original error.
    queue = (async () => {
      try {
        await delivered;
      } catch (error) {
        failure =
          error instanceof Error
            ? error
            : new Error("MCP progress delivery failed", { cause: error });
        close();
      }
    })();
    heartbeatTimer = setTimeout(() => {
      if (!closed) {
        void (async () => {
          try {
            await send(update);
          } catch {
            close();
          }
        })();
      }
    }, heartbeatIntervalMs);
    await delivered;
  };
  const flush = async (): Promise<void> => {
    await queue;
    if (failure !== undefined) {
      throw failure;
    }
    clearTimeout(textTimer);
    textTimer = undefined;
    const update = pendingText;
    pendingText = undefined;
    if (update === undefined) {
      await queue;
      return;
    }
    lastTextAt = Date.now();
    await send(update);
  };
  signal.addEventListener("abort", close, { once: true });

  return {
    close,
    flush,
    onProgress: async (event: AppAgentMcpProgress): Promise<void> => {
      signal.throwIfAborted();
      await queue;
      if (failure !== undefined) {
        throw failure;
      }
      if (closed) {
        return;
      }
      const update = snapshot(event);
      if (update === undefined) {
        if (event.status === "streaming" && event.chunk.type === "text-end") {
          await flush();
        }
        return;
      }
      const previous = pendingText ?? latest;
      if (JSON.stringify(update) === JSON.stringify(previous)) {
        return;
      }
      if (update.activity.status !== "text") {
        await flush();
        await send(update);
        return;
      }
      pendingText = update;
      const remaining = textIntervalMs - (Date.now() - lastTextAt);
      if (remaining <= 0) {
        await flush();
      } else {
        textTimer ??= setTimeout(() => {
          void (async () => {
            try {
              await flush();
            } catch {
              close();
            }
          })();
        }, remaining);
      }
    },
  };
};
