import { stripVTControlCharacters } from "node:util";

import type { UIMessageChunk } from "ai";
import { z } from "zod";

interface AppAgentMcpRun {
  appId: string;
  runId: string;
  threadId: string;
}

/** Structured event carried in notifications/progress.params._meta. */
export type AppAgentMcpProgress = AppAgentMcpRun &
  ({ status: "started" } | { chunk: UIMessageChunk; status: "streaming" });

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

/** Request-local state lets ordinary MCP clients display meaningful snapshots. */
export const createProgressMessage = () => {
  const text = new Map<string, string>();
  let message = "App agent is working.";

  return (event: AppAgentMcpProgress): string => {
    if (event.status === "started") {
      message = preview(`App agent started for app ${event.appId}.`);
      return message;
    }
    const { chunk } = event;
    // Tool results and bookkeeping retain the last visible message. Detailed
    // outcomes remain available in the structured stream.
    if (chunk.type === "text-delta") {
      // Bound the text retained per active block. Progress messages contain
      // cumulative text, not individual token fragments or private reasoning.
      const current = `${text.get(chunk.id) ?? ""}${chunk.delta}`.slice(
        -maximumPreviewLength
      );
      text.set(chunk.id, current);
      message = preview(current) || message;
    } else if (chunk.type === "text-end") {
      text.delete(chunk.id);
    } else if (
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error"
    ) {
      message = describeTool(toolAction(chunk));
    } else if (chunk.type === "error") {
      message =
        "App agent encountered an error. Check the app before retrying.";
    } else if (chunk.type === "abort") {
      message = "App agent stopped. Check the app before repeating a change.";
    } else if (chunk.type === "finish") {
      message = "App agent finished generating; waiting for workflow cleanup.";
    }
    return message;
  };
};
