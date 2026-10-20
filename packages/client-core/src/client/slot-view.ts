import type { PatchsmithContract } from "@patchsmith/core/schema";
import { composeViewContext, getViewHierarchy } from "@patchsmith/core/views";
import type { ActiveView } from "@patchsmith/core/views";

import type { PatchsmithApp } from "#types";

/** Select the supported view without reading or composing its context. */
export const selectSlotView = (
  views: NonNullable<PatchsmithApp["views"]>,
  slot: string,
  activePath: string,
  schema: Pick<PatchsmithContract, "slots" | "views">
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
  views: NonNullable<PatchsmithApp["views"]>,
  slot: string,
  activeView: ActiveView,
  schema: Pick<PatchsmithContract, "slots" | "views">
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
