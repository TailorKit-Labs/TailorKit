// Public SDK declarations used by the capability guides.
// oxlint-disable oxc/no-barrel-file -- TypeDoc needs one entry point to collect the documented SDK symbols.
export type { CallbackDefinition } from "../packages/core/src/schema/callbacks";
export type { ComponentDefinition } from "../packages/core/src/schema/components";
export { defineContract } from "../packages/core/src/schema/contract";
export type { TailorKitContract } from "../packages/core/src/schema/contract";
export type {
  ContractTool,
  ToolContext,
} from "../packages/core/src/schema/tools";
export type { SlotDefinitions } from "../packages/core/src/schema/views";
export type { UseViewContext } from "../packages/react/src/hooks/use-view-context";
export type { ViewContextState } from "../packages/client-core/src/store/local/view-context-types";
export { defineView } from "../packages/app/src/views";
export type { ViewInstance, ViewInstances } from "../packages/app/src/views";
