export { tool, flattenTools, validateToolValue } from "./tools";

export { experimental_canvas } from "./canvas";

export type {
  experimental_CanvasInputPolicy,
  experimental_CanvasPolicy,
  experimental_CanvasProps,
} from "./canvas";

export type {
  ContractTool,
  ContractTools,
  ToolImplementations,
  ToolCallers,
  ToolContext,
  ToolIdentity,
  InferToolInput,
  InferToolOutput,
} from "./tools";

export {
  type CallbackMap,
  type Callback,
  type Callbacks,
  type CallbackDefinition,
  type InferCallback,
  type InferCallbacks,
} from "./callbacks";

export {
  type Component,
  type ComponentDefinitions,
  type Components,
  type ComponentDefinition,
  type ComponentProps,
  type Fields,
  type NoComponentFieldCallbackConflicts,
  type ResolvedComponentMetadata,
} from "./components";

export {
  type ContextDefinitions,
  type View,
  type ViewContextHierarchy,
  type ViewDefinitions,
  type ViewDefinition,
  type Views,
  type SlotDefinitions,
  type ResolvedViewMetadata,
} from "./views";

export {
  type EmptyDefinitionMap,
  type Schema,
  type SchemaSerializer,
  type SchemaSerializerOptions,
  jsonSchemaSerializer,
} from "./shared";

export {
  createPatchsmithSchema,
  type Patchsmith,
  type PatchsmithSchema,
} from "./schema";

export type { PatchsmithTheme } from "#primitives/theme";

export { defineContract } from "./contract";

export type { PatchsmithContract } from "./contract";

export { hook } from "./hooks";

export type {
  ContractHook,
  ContractHooks,
  InferHookInput,
  InferHookOutput,
} from "./hooks";
