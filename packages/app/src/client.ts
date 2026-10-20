// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "./views";
export * from "./preact";
export { defineRoute, Route, createFileClient } from "./routing";
export type { RouteDefinition, ShellProps } from "./routing";
export {
  createClient,
  createSessionProvider,
  reference,
} from "./client/connection";
export { createApi } from "./client/reference";
export type {
  Client,
  Session,
  Reference,
  References,
} from "./client/connection";
export { AppError, appError } from "./errors";
export type { ErrorCode } from "./errors";
export { callTool } from "./client/tools";
export type { PatchsmithServerTools, ToolBridge } from "./client/tools";
