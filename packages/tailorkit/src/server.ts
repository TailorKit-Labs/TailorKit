export { createServer, createTailorKitClient } from "@tailorkit/core/server";
export type {
  ToolImplementations,
  ContractScopes,
} from "@tailorkit/core/server";
export type {
  TailorKitRouter,
  TailorKitRouterClient,
} from "@tailorkit/core/server";
export type {
  TailorKitHandlerContext,
  TailorKitHandlerOptions,
  TailorKitHostContext,
  TailorKitInstallAppOptions,
  TailorKitInstalledApp,
  TailorKitPlatformOptions,
  TailorKitServer,
  TailorKitServerOptions,
} from "@tailorkit/core/server/types";
// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "@tailorkit/app/server";
