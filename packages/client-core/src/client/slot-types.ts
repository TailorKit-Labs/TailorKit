import type { ViewInstance } from "@patchsmith/app/client";
import type { SlotDefinitions, ViewDefinition } from "@patchsmith/core/schema";
import type { ActiveView, ViewStatus } from "@patchsmith/core/views";

import type { ViewContext, ViewName } from "#store/local/view-context-types";
import type { PatchSmithApp } from "#types";

type DefaultViews = Record<`/${string}`, ViewDefinition>;
type ContextPaths<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews>,
> = {
  [P in ViewName<TViews>]: P extends "/" | TView
    ? P
    : TView extends `${P}/${string}`
      ? P
      : never;
}[ViewName<TViews>];
type ContextFields<TView> =
  undefined extends ViewContext<TView>
    ? Partial<Exclude<ViewContext<TView>, undefined>>
    : ViewContext<TView>;

export type RenderSlotContext<
  TViews extends Record<string, ViewDefinition>,
  TView extends ViewName<TViews>,
> = {
  [P in ContextPaths<TViews, TView>]: (
    context: ContextFields<TViews[P]>
  ) => void;
}[ContextPaths<TViews, TView>] extends (context: infer TContext) => void
  ? TContext
  : never;

export interface RuntimeRenderSlotProps {
  app: PatchSmithApp;
  /** The host slot to render in. */
  slot: string;
  /** Select an instance of the matching view. */
  instanceKey?: string;
}

type InstanceProps<TSlot, TKey extends string, TValue> = boolean extends (
  TSlot extends { multiple?: infer T } ? T : false
)
  ? Partial<Record<TKey, TValue>>
  : TSlot extends { multiple: true }
    ? Record<TKey, TValue>
    : Partial<Record<TKey, never>>;

export type RenderSlotProps<TSlots extends SlotDefinitions = SlotDefinitions> =
  {
    [TSlot in keyof TSlots & string]: {
      app: PatchSmithApp;
      slot: TSlot;
    } & InstanceProps<TSlots[TSlot], "instanceKey", string>;
  }[keyof TSlots & string];

export type ControlledRenderSlotProps<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = {
  [TSlot in keyof TSlots & string]: {
    [TView in Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>]: {
      app: PatchSmithApp;
      slot: TSlot;
      view: TView;
    } & (
      | ({
          context: RenderSlotContext<TViews, TView>;
          status: "ready";
        } & InstanceProps<TSlots[TSlot], "instance", ViewInstance>)
      | { context?: never; status: "loading" | "error"; instance?: never }
    );
  }[Extract<ViewName<TViews>, TSlots[TSlot]["views"][number]>];
}[keyof TSlots & string];

export type SlotState =
  | ActiveView
  | {
      view: string;
      controlled: true;
      context?: unknown;
      status: ViewStatus;
      instance?: ViewInstance;
    };
