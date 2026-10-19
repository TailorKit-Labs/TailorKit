export { createServer, createPatchSmithClient } from "@patchsmith/core/server";
export type {
  ToolImplementations,
  ContractScopes,
} from "@patchsmith/core/server";
export type {
  PatchSmithRouter,
  PatchSmithRouterClient,
} from "@patchsmith/core/server";
export type {
  PatchSmithHandlerContext,
  PatchSmithHandlerOptions,
  PatchSmithHostContext,
  PatchSmithInstallAppOptions,
  PatchSmithInstalledApp,
  PatchSmithPlatformOptions,
  PatchSmithServer,
  PatchSmithServerOptions,
} from "@patchsmith/core/server/types";
// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "@patchsmith/app/server";
