export { RenderSlot } from "./components/render-slot";

export { experimental_canvasRenderer } from "./canvas";

export type {
  ControlledRenderSlotProps,
  RenderSlotComponent,
  RenderSlotContext,
  RenderSlotProps,
} from "./components/render-slot";

export { components, createClient } from "./patchsmith";

export type {
  PatchsmithApp,
  PatchsmithClientConfig,
  PatchsmithInstance,
  PatchsmithProviderProps,
} from "./patchsmith";

export type { UseAppsOptions, UseAppsResult } from "./hooks/use-apps";

export type {
  SlotItem,
  UseViewsOptions,
  UseViewsResult,
  ViewResolutionWarning,
} from "./hooks/use-views";

export type {
  UseViewContext,
  ViewOptions,
  ViewState,
} from "./hooks/use-view-context";

export { primitives } from "./primitives";

export { Icon } from "#icons/icon";

export type { IconRendererOptions } from "#icons/loader";

export type {
  IconLibrary,
  IconName,
  IconOptions,
  IconProps,
  LucideIconName,
} from "@patchsmith/core/icons";
