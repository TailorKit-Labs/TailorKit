import type { TailorKitContract } from "@tailorkit/core/schema";
import { composeViewContext, getViewHierarchy } from "@tailorkit/core/views";
import type { ActiveView } from "@tailorkit/core/views";

import type { TailorKitApp } from "#types";

/** Select the supported view without reading or composing its context. */
export const selectSlotView = (
  views: NonNullable<TailorKitApp["views"]>,
  slot: string,
  activePath: string,
  schema: Pick<TailorKitContract, "slots" | "views">
) => {
  const supported = schema.slots[slot]?.views ?? [];
  const path = getViewHierarchy(activePath).find(
    (pathValue) =>
      supported.includes(pathValue) &&
      views.some(
        (view) =>
          view.slot === slot && view.path === pathValue && !view.disabled
      )
  );
  return (
    views.find(
      (view) => view.slot === slot && view.path === path && !view.disabled
    ) ?? null
  );
};

/** Match the same path and compose the same ancestor context as the sandbox renderer. */
export const resolveSlotView = (
  views: NonNullable<TailorKitApp["views"]>,
  slot: string,
  activeView: ActiveView,
  schema: Pick<TailorKitContract, "slots" | "views">
) => {
  const view = selectSlotView(views, slot, activeView.view, schema);
  if (!view) {
    return null;
  }
  return {
    ...composeViewContext(view.path, {
      declaredViews: Object.keys(schema.views),
      layers: activeView.layers,
    }),
    instances: Boolean(view.instances),
  };
};
